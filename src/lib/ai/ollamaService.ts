/**
 * Enhanced Ollama Service with Ultra-Fast Processing
 *
 * Features:
 * - Chat API support for better context handling
 * - Streaming responses for real-time feedback
 * - Document processing with embeddings
 * - Parallel processing capabilities
 * - Response caching for speed
 * - Optimized model selection
 */

import { generateTextToString, listModels } from "./ollamaClient";
import { DOCUMENT_PROMPTS, formatPrompt } from "@/config/prompts";
import { getModelForTask, getRuntimeModelForTask, type OllamaTask } from "@/config/ollamaModels";
import { getOllamaBaseUrl, isOllamaEnabled } from "@/config/ollamaConfig";
import { createRequestDeadline, type RequestDeadlineOptions } from './requestDeadline';
import { generateServerAiResponse } from "./serverAiClient";
import { getLocalModelSettings, isCompatibleLocalModelSelected } from "@/config/localModelConfig";
import { completeCompatibleLocalChat } from "./openAICompatibleLocalClient";

/**
 * Helper to fetch with exponential backoff retry
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 500): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (options.signal || retries <= 0) throw error;
    
    console.warn(`Fetch failed, retrying in ${backoff}ms... (${retries} retries left)`, error);
    await new Promise(resolve => setTimeout(resolve, backoff));
    return fetchWithRetry(url, options, retries - 1, backoff * 2);
  }
}



// Optimized model configurations - Using centralized config
// Keep the compatibility surface used by generators, but resolve choices on
// access rather than once when this module is first imported.
export const FAST_MODELS = {
  get chat() { return getModelForTask("chat"); },
  get summarize() { return getModelForTask("summarize"); },
  get embeddings() { return getModelForTask("embeddings"); },
  get code() { return getModelForTask("code"); },
  get title() { return getModelForTask("title"); },
};

/**
 * Utility: sanitize text before sending to models
 * - Removes rare/invalid control characters that cause mojibake
 * - Removes Unicode replacement characters
 * - Trims and collapses excessive whitespace
 * - Use early to avoid sending binary-like content to LM models
 */
function sanitizeText(input: string | undefined | null): string {
  if (!input) return "";
  try {
    // Normalize to NFC, remove standalone replacement characters and control bytes
    const normalized = String(input).normalize
      ? String(input).normalize("NFC")
      : String(input);

    // Remove C0 control chars except \t \n \r and keep common unicode range
    const cleaned = normalized
      .replace(/[^\t\n\r\u0020-\u007E\u00A0-\uD7FF\uE000-\uFFFD]/g, "")
      .replace(/\uFFFD/g, "") // remove replacement char if present
      .replace(/\s{2,}/g, " ")
      .trim();

    return cleaned;
  } catch {
    // Fallback conservative cleaning
    return String(input)
      .replace(/[^\t\n\r\u0020-\u007E]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
}

const CHAT_PROMPT_LIMIT = 20_000;
const SOURCE_OMISSION_MARKER = "\n[Source excerpt shortened to fit the prompt.]";

/** Keep paragraph boundaries while applying the same control-character cleanup used elsewhere. */
function sanitizePromptText(input: string): string {
  try {
    return String(input).normalize("NFC")
      .replace(/[^\t\n\r\u0020-\u007E\u00A0-\uD7FF\uE000-\uFFFD]/g, "")
      .replace(/\uFFFD/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return String(input).replace(/[^\t\n\r\u0020-\u007E]/g, "").trim();
  }
}

/**
 * Bound prompt context from the source-heavy middle. System directions and the
 * latest user turn stay intact; when needed, older dialogue is dropped before
 * source evidence. Unlike sanitizeText, this preserves paragraph structure.
 */
export function buildOllamaChatPrompt(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxChars = CHAT_PROMPT_LIMIT,
): string {
  const normalized = messages.map((message) => ({
    role: message.role,
    content: sanitizePromptText(String(message.content)),
  })).filter((message) => message.content.length > 0);
  const latestUserIndex = normalized.map((message) => message.role).lastIndexOf("user");
  const latestUser = latestUserIndex >= 0 ? normalized[latestUserIndex] : undefined;
  const systemMessages = normalized.filter((message) => message.role === "system");
  const history = normalized.filter((message, index) => message.role !== "system" && index !== latestUserIndex);

  const render = (items: typeof normalized) => items.map(({ role, content }) => {
    const label = role === "user" ? "User" : role === "assistant" ? "Assistant" : "System";
    return `${label}: ${content}`;
  }).join("\n\n");
  const sourceParts = systemMessages.map((system) => {
    const marker = system.content.match(/\n?(Notebook source material:|Source material:)/i);
    return marker?.index === undefined
      ? { base: system, tail: "" }
      : {
          base: { ...system, content: system.content.slice(0, marker.index + marker[0].length) },
          tail: system.content.slice(marker.index + marker[0].length),
        };
  });
  const baseSystems = sourceParts.map(({ base }) => base);
  const latestUserItem = latestUser ? [latestUser] : [];
  const basePrompt = render([...baseSystems, ...latestUserItem]);
  if (basePrompt.length >= maxChars) {
    // Preserve the latest request even if an unusually large instruction alone
    // consumes the whole limit.
    const userText = latestUser ? `User: ${latestUser.content}` : "";
    const systemText = render(baseSystems);
    const budget = Math.max(0, maxChars - userText.length - (userText ? 2 : 0));
    return [systemText.slice(0, budget), userText].filter(Boolean).join("\n\n").slice(-maxChars);
  }

  let remaining = maxChars - basePrompt.length - (history.length ? 4 : 0);
  const keptHistory: typeof normalized = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    const rendered = render([item]);
    if (rendered.length + (keptHistory.length ? 4 : 0) > remaining) break;
    keptHistory.unshift(item);
    remaining -= rendered.length + (keptHistory.length > 1 ? 4 : 0);
  }

  const historyPrompt = render(keptHistory);
  const historyCost = historyPrompt.length + (historyPrompt ? 4 : 0);
  // Reserve equal opportunities for every selected source. A sequential slice
  // lets the first large source starve later ones, even when they contain the
  // evidence needed for the question. Keep each `[n] title` header intact so
  // source numbering remains consistent with citations in the learning prompt.
  const sourceBudget = Math.max(0, maxChars - basePrompt.length - historyCost - 4 * sourceParts.length);
  const boundedTails = balanceSourceTails(sourceParts.map(({ tail }) => tail), sourceBudget);
  const boundedSystems = sourceParts.map(({ base }, index) => ({
    ...base,
    content: `${base.content}${boundedTails[index]}`,
  }));
  const result = render([...boundedSystems, ...keptHistory, ...latestUserItem]);
  return result.length <= maxChars ? result : result.slice(-maxChars);
}

/**
 * Budget marked source tails with max-min fairness across source entries.
 * Unlabelled tails are treated as one source. The marker cost is included in
 * the budget, and source headers are retained even when no body fits.
 */
function balanceSourceTails(tails: string[], budget: number): string[] {
  type Entry = { tailIndex: number; header: string; body: string };
  const entries: Entry[] = [];
  const preambles = tails.map((tail, tailIndex) => {
    const headers = [...tail.matchAll(/^\[\d+\][^\n]*(?:\n|$)/gm)];
    if (headers.length === 0) {
      if (tail) entries.push({ tailIndex, header: "", body: tail });
      return "";
    }
    const preamble = tail.slice(0, headers[0].index);
    headers.forEach((match, index) => {
      const start = match.index!;
      const bodyStart = start + match[0].length;
      const bodyEnd = index + 1 < headers.length ? headers[index + 1].index! : tail.length;
      entries.push({ tailIndex, header: match[0], body: tail.slice(bodyStart, bodyEnd) });
    });
    return preamble;
  });
  if (!entries.length) return tails;

  const fixedCost = preambles.reduce((sum, value) => sum + value.length, 0)
    + entries.reduce((sum, entry) => sum + entry.header.length, 0);
  let remaining = Math.max(0, budget - fixedCost);
  const allocations = entries.map(() => 0);
  // Grow every non-exhausted source by one character per round. The marker is
  // charged when that source is clipped, preventing a final safety slice from
  // accidentally removing directions or the newest user turn.
  let active = entries.map((entry, index) => entry.body.length > 0 ? index : -1).filter((index) => index >= 0);
  while (remaining > 0 && active.length) {
    const markerCount = active.filter((index) => allocations[index] < entries[index].body.length).length;
    const markerCost = markerCount * SOURCE_OMISSION_MARKER.length;
    if (remaining <= markerCost) break;
    const charBudget = remaining - markerCost;
    const rounds = Math.max(1, Math.floor(charBudget / active.length));
    let used = 0;
    for (const index of active) {
      const take = Math.min(rounds, entries[index].body.length - allocations[index]);
      allocations[index] += take;
      used += take;
    }
    remaining -= used;
    active = active.filter((index) => allocations[index] < entries[index].body.length);
    if (used === 0) break;
  }

  const markersNeeded = entries.reduce((count, entry, index) => count + (allocations[index] < entry.body.length ? 1 : 0), 0);
  let markerBudget = Math.max(0, budget - fixedCost - allocations.reduce((sum, value) => sum + value, 0));
  const markerAllowed = markersNeeded * SOURCE_OMISSION_MARKER.length <= markerBudget;
  const renderedEntries = entries.map((entry, index) => {
    const clipped = allocations[index] < entry.body.length;
    const marker = clipped && markerAllowed ? SOURCE_OMISSION_MARKER : "";
    markerBudget -= marker.length;
    return `${entry.header}${entry.body.slice(0, allocations[index])}${marker}`;
  });
  return tails.map((_, tailIndex) => {
    const chunks = entries.map((entry, index) => entry.tailIndex === tailIndex ? renderedEntries[index] : "").join("");
    return `${preambles[tailIndex]}${chunks}`;
  });
}

/**
 * Heuristic: detect if text looks mostly binary (avoid sending to LMs)
 */
function isMostlyBinary(input: string | undefined | null): boolean {
  if (!input) return false;
  const s = String(input);
  if (s.length === 0) return false;
  let nonText = 0;
  const len = Math.min(s.length, 1000);
  for (let i = 0; i < len; i++) {
    const code = s.charCodeAt(i);
    // allow tab, newline, carriage return and printable ascii/unicode ranges
    if (code === 9 || code === 10 || code === 13) continue;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 55295)) continue;
    nonText++;
  }
  return nonText / len > 0.1;
}

/**
 * Check if content is likely to be readable text
 */
function isReadableText(content: string): boolean {
  if (!content || content.length === 0) return false;
  
  // Check for minimum length
  if (content.length < 10) return false;
  
  // Check for presence of actual content (not just symbols/numbers)
  const words = content.match(/\b\w+\b/g);
  if (!words || words.length < 2) return false;
  
  // Check for reasonable character diversity
  const uniqueChars = new Set(content).size;
  const ratio = uniqueChars / content.length;
  return ratio > 0.1; // At least 10% unique characters
}

// Cache for available models to avoid repeated API calls
const modelsCache = new Map<string, { models: string[]; timestamp: number }>();
const MODELS_CACHE_TTL = 60000; // 1 minute

/**
 * Get cached models or fetch fresh list
 */
async function getAvailableModelsCached(signal?: AbortSignal): Promise<string[]> {
  const endpoint = getOllamaBaseUrl();
  const now = Date.now();
  const cached = modelsCache.get(endpoint);
  if (cached && now - cached.timestamp < MODELS_CACHE_TTL) {
    return cached.models;
  }

  try {
    const models = await listModels(undefined, signal);
    modelsCache.set(endpoint, { models, timestamp: now });
    return models;
  } catch (err) {
    signal?.throwIfAborted();
    console.error("Failed to fetch models:", err);
    return modelsCache.get(endpoint)?.models || [];
  }
}

/**
 * Resolve a requested model name against available models returned by the Ollama API.
 * If the exact model isn't available, try to find a model with the same prefix (before ':').
 * If nothing matches, fall back to the first available model and log a warning.
 */
async function resolveModelName(requested: string, signal?: AbortSignal, strict = false): Promise<string> {
  const endpoint = getOllamaBaseUrl();
  try {
    const available = await getAvailableModelsCached(signal);
    if (!available || available.length === 0) {
      if (strict) throw new Error(`Selected Ollama model "${requested}" could not be verified at ${endpoint}; no models were returned.`);
      console.warn(
        "âš ï¸ No models available from Ollama server. Is Ollama running?",
      );
      return requested;
    }

    // Exact match first
    if (available.includes(requested)) return requested;

    if (strict) {
      throw new Error(`Selected Ollama model "${requested}" is not installed at ${endpoint}. Refresh model discovery or choose an installed model.`);
    }

    // Prefer models that support generation (exclude obvious embedding-only models)
    const generationCandidates = available.filter(
      (m) => !/embed/i.test(m) && !/embedding/i.test(m),
    );

    // Try prefix match (e.g., tinyllama matches tinyllama:1.1b)
    const prefix = requested.split(":")[0];
    const byPrefix =
      generationCandidates.find((m) => m.startsWith(prefix + ":")) ||
      available.find((m) => m.startsWith(prefix + ":"));
    if (byPrefix) {
      return byPrefix;
    }

    // A missing embedding model cannot be replaced with a text generator.
    if (/embed/i.test(requested)) return requested;

    // If no generation-specific candidates, fall back to the first non-embedding model
    if (generationCandidates.length > 0) {
      return generationCandidates[0];
    }

    // As a last resort, pick the first available model
    return available[0];
  } catch (err) {
    signal?.throwIfAborted();
    if (strict) throw err;
    console.error("Error resolving model name:", err);
    return requested;
  }
}

function hasRuntimeModelSelection(task: OllamaTask): boolean {
  return getRuntimeModelForTask(task) !== undefined;
}

// Response cache for ultra-fast repeated queries
const responseCache = new Map<
  string,
  { response: string; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key from prompt and model using a hash of the full prompt
 */
function getCacheKey(model: string, prompt: string): string {
  // Create a hash of the full prompt to ensure uniqueness while keeping the key manageable
  let hash = 0;
  const str = `${model}:${prompt}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use absolute value to avoid negative hash values in the key
  return `${model}:${Math.abs(hash)}`;
}

/**
 * Get cached response if available and not expired
 */
function getCachedResponse(model: string, prompt: string): string | null {
  const key = getCacheKey(model, prompt);
  const cached = responseCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("ðŸš€ Cache hit! Ultra-fast response");
    return cached.response;
  }

  return null;
}

/**
 * Cache a response
 */
function cacheResponse(model: string, prompt: string, response: string): void {
  const key = getCacheKey(model, prompt);
  responseCache.set(key, { response, timestamp: Date.now() });

  // Limit cache size to 100 entries
  if (responseCache.size > 100) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
}

/**
 * Ultra-fast chat completion with streaming support
 */
type ChatCompletionParams = RequestDeadlineOptions & {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  onChunk?: (chunk: string) => void;
  /** Force local inference for this request; failures are surfaced without cloud fallback. */
  localOnly?: boolean;
};

export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  if (params.maxOutputTokens !== undefined && (!Number.isInteger(params.maxOutputTokens) || params.maxOutputTokens < 1 || params.maxOutputTokens > 8192)) {
    throw new Error("maxOutputTokens must be an integer between 1 and 8192");
  }
  const scope = createRequestDeadline(params);
  try {
    scope.signal.throwIfAborted();
    const result = await chatCompletionInternal({ ...params, signal: params.signal || params.deadlineAt !== undefined ? scope.signal : undefined });
    scope.signal.throwIfAborted();
    return result;
  } finally {
    scope.dispose();
  }
}

async function chatCompletionInternal(params: ChatCompletionParams): Promise<string> {
  const compatibleSettings = getLocalModelSettings();
  if (compatibleSettings.provider !== "ollama" && (isCompatibleLocalModelSelected() || params.localOnly)) {
    const promptMessages = params.messages.map((message) => ({ ...message, content: sanitizePromptText(message.content) }));
    const selectedModel = params.model || compatibleSettings.model;
    if (!selectedModel) throw new Error("Choose a local model in Local model connection settings before sending a chat request.");
    try {
      return await completeCompatibleLocalChat({
        model: selectedModel,
        messages: promptMessages,
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
        jsonMode: params.jsonMode,
        signal: params.signal,
        onChunk: params.stream ? params.onChunk : undefined,
      });
    } catch (error) {
      // Never conceal a selected local provider failure with a cloud request.
      if (error instanceof Error) throw error;
      throw new Error(`Local model request failed: ${String(error)}`);
    }
  }
  // When local inference is disabled, use the authenticated server provider chain.
  if (!isOllamaEnabled(params.localOnly)) {
    return generateServerAiResponse(params.messages, params.temperature ?? 0.7, params);
  }

  const requestedModel = params.model || FAST_MODELS.chat;
  const model = await resolveModelName(requestedModel, params.signal, Boolean(params.model) || hasRuntimeModelSelection("chat"));
  params.signal?.throwIfAborted();

  // Keep instructions and the newest request while budgeting source text/history.
  const sanitizedPrompt = buildOllamaChatPrompt(params.messages);
  const finalPrompt = sanitizedPrompt + "\n\nAssistant:";

  // If prompt looks binary or mostly non-text after sanitization, fail fast
  if (isMostlyBinary(finalPrompt)) {
    throw new Error(
      "Prompt appears to contain binary or corrupted text; aborting request.",
    );
  }

  // Check cache for non-streaming requests
  // Use the full prompt (not just first 100 chars) to avoid cache collisions
  const useCache = params.maxOutputTokens === undefined && !params.jsonMode;
  if (!params.stream && useCache) {
    const cached = getCachedResponse(model, sanitizedPrompt); // Use sanitizedPrompt instead of original prompt
    if (cached) return cached;
  }

  try {
    if (params.stream && params.onChunk) {
      // Streaming mode
      const response = await fetchWithRetry(`${getOllamaBaseUrl()}/api/generate`, {
        signal: params.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: finalPrompt,
          stream: true,
          think: false,
          ...(params.jsonMode ? { format: "json" } : {}),
          options: {
            temperature: params.temperature ?? 0.7,
            num_predict: params.maxOutputTokens ?? 1024,
            top_k: 40,
            top_p: 0.9,
            num_ctx: params.jsonMode || (params.maxOutputTokens ?? 0) > 1024 ? 16384 : 2048,
          },
        }),
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              fullResponse += json.response;
              params.onChunk(json.response);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      if (useCache) cacheResponse(model, sanitizedPrompt, fullResponse);
      return fullResponse;
    } else {
      // Non-streaming mode - ultra fast
      // Use smaller context for chat queries, larger for document processing
      const isShortQuery = sanitizedPrompt.length < 500;
      const timeoutMs = isShortQuery ? 30000 : 120000;
      // Ollama's fetch timeout only covers waiting for response headers. The
      // non-streaming client then consumes response.json(), which can hang if
      // the server stalls mid-body. Keep our own deadline alive through the
      // complete generateTextToString() call so the chat mutation can recover.
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => {
        timeoutController.abort(new DOMException("Ollama generation timed out", "TimeoutError"));
      }, timeoutMs);
      const abortOnCallerSignal = () => timeoutController.abort(params.signal?.reason);
      params.signal?.addEventListener("abort", abortOnCallerSignal, { once: true });
      if (params.signal?.aborted) abortOnCallerSignal();
      const requestSignal = params.signal
        ? AbortSignal.any([params.signal, timeoutController.signal])
        : timeoutController.signal;
      try {
        const result = await generateTextToString({
          model,
          prompt: finalPrompt,
          stream: false,
          params: {
            think: false,
            ...(params.jsonMode ? { format: "json" } : {}),
            options: {
              temperature: params.temperature ?? 0.7,
              // Keep long grounded replies bounded while leaving room for the
              // source-heavy prompt and its citations in the model context.
              num_predict: params.maxOutputTokens ?? (isShortQuery ? 512 : 1024),
              top_k: 40,
              top_p: 0.9,
              // buildOllamaChatPrompt permits up to 20k characters (roughly
              // 5k+ tokens), so 4096 could crowd out the latest source evidence.
              num_ctx: params.jsonMode || (params.maxOutputTokens ?? 0) > 1024 ? 16384 : (isShortQuery ? 2048 : 8192),
            },
          },
          signal: requestSignal,
          timeoutMs,
        });

        if (useCache) cacheResponse(model, sanitizedPrompt, result);
        return result;
      } finally {
        clearTimeout(timeout);
        params.signal?.removeEventListener("abort", abortOnCallerSignal);
      }
    }
  } catch (error) {
    console.error("Ollama chat error:", error);
    if (error instanceof TypeError || (error instanceof Error && /fetch|network|connection|failed to connect/i.test(error.message))) {
      const unavailable = new Error("Could not reach Ollama from this browser. Check that Ollama is running and the configured endpoint is reachable; browser permissions or CORS can also block access.");
      (unavailable as Error & { cause?: unknown }).cause = error;
      throw unavailable;
    }
    throw error;
  }
}

// Embedding cache for ultra-fast repeated queries
const embeddingCache = new Map<
  string,
  { embedding: number[]; timestamp: number }
>();
const EMBEDDING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Generate embeddings for document processing with caching
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  // Cloud embedding keys must never be shipped in the browser bundle. When
  // local Ollama is disabled, callers use deterministic keyword ranking.
  if (!isOllamaEnabled()) return [];

  // Create cache key using hash of full text to avoid collisions from substring
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const cacheKey = Math.abs(hash).toString();
  const cached = embeddingCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL) {
    return cached.embedding;
  }

  try {
    const embeddingsModel = await resolveModelName(FAST_MODELS.embeddings, undefined, hasRuntimeModelSelection("embeddings"));
    const response = await fetchWithRetry(`${getOllamaBaseUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingsModel,
        prompt: text.substring(0, 1000), // Limit to 1000 chars for speed
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embeddings error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const embedding = data.embedding || [];

    // Cache the result
    embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });

    // Limit cache size
    if (embeddingCache.size > 500) {
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey);
    }

    return embedding;
  } catch (error) {
    console.error("Embeddings generation error:", error);
    return [];
  }
}

/**
 * Process document with ultra-fast extraction
 */
export async function processDocument(params: {
  content: string;
  type: string;
  title?: string;
}): Promise<{
  summary: string;
  keywords: string[];
  embeddings: number[];
}> {
  const model = FAST_MODELS.summarize;

  // Get prompts from configuration
  const summarizePrompt = DOCUMENT_PROMPTS.summarize;
  const keywordsPrompt = DOCUMENT_PROMPTS.keywords;

  // Parallel processing for speed
  // Sanitize content before sending to LM and embedding generator
  const safeSummaryContent = sanitizeText(params.content.substring(0, 2000));
  const safeKeywordsContent = sanitizeText(params.content.substring(0, 1000));
  const safeEmbeddingContent = sanitizeText(params.content.substring(0, 1000));

  const [summary, keywords, embeddings] = await Promise.all([
    // Generate summary using configured prompt
    chatCompletion({
      messages: [
        {
          role: "system",
          content: summarizePrompt.system,
        },
        {
          role: "user",
          content: formatPrompt(summarizePrompt.userTemplate, {
            type: params.type,
            content: safeSummaryContent,
          }),
        },
      ],
      model,
      temperature: summarizePrompt.temperature,
    }),

    // Extract keywords using configured prompt
    chatCompletion({
      messages: [
        {
          role: "system",
          content: keywordsPrompt.system,
        },
        {
          role: "user",
          content: formatPrompt(keywordsPrompt.userTemplate, {
            content: safeKeywordsContent,
          }),
        },
      ],
      model,
      temperature: keywordsPrompt.temperature,
    }).then((result) =>
      result
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),

    // Generate embeddings (use sanitized slice)
    generateEmbeddings(safeEmbeddingContent),
  ]);

  return { summary, keywords, embeddings };
}

/**
 * Generate title from content - ultra fast
 */
export async function generateTitle(content: string): Promise<string> {
  const cached = getCachedResponse(
    FAST_MODELS.title,
    content, // Use full content; the cache key function now properly handles this
  );
  if (cached) return cached;

  const titlePrompt = DOCUMENT_PROMPTS.title;

  // Sanitize and validate content before title generation
  const safeTitleContent = sanitizeText(content.substring(0, 500));
  if (isMostlyBinary(safeTitleContent)) {
    // If content looks binary or corrupted, return a fallback title
    return "Untitled Document (binary or unreadable content)";
  }

  // Check if the content contains error messages from extraction failure
  if (safeTitleContent.includes("extraction failed") || 
      safeTitleContent.includes("Unable to extract text") ||
      safeTitleContent.includes("PDF contains no extractable text") ||
      safeTitleContent.includes("extraction/OCR failed") ||
      safeTitleContent.includes("encrypted or password-protected") ||
      safeTitleContent.includes("corrupted or in an unsupported format")) {
    // If the content is an extraction error message, extract the filename from the error
    const fileNameMatch = safeTitleContent.match(/from "([^"]+)"/);
    if (fileNameMatch && fileNameMatch[1]) {
      return fileNameMatch[1];
    }
    return "Error Extracting Document";
  }

  const title = await chatCompletion({
    messages: [
      {
        role: "system",
        content: titlePrompt.system,
      },
      {
        role: "user",
        content: formatPrompt(titlePrompt.userTemplate, {
          content: safeTitleContent,
        }),
      },
    ],
    model: FAST_MODELS.title,
    temperature: titlePrompt.temperature,
  });

  return title
    .trim()
    .replace(/^["'`\s]*|["'`\s]*$/g, "")
    .split(/\n/)[0]
    .trim();
}

/**
 * Check if Ollama is available and running
 */
export async function checkOllamaHealth(): Promise<boolean> {
  if (!isOllamaEnabled()) return false;

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      method: "GET",
      signal: (() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10000);
        return controller.signal;
      })(),
    });

    if (response.ok) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get available models (uses cache)
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    return await getAvailableModelsCached();
  } catch {
    return [];
  }
}

/**
 * Pull a model if not available
 */
export async function pullModel(
  modelName: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const response = await fetchWithRetry(`${getOllamaBaseUrl()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) throw new Error(`Failed to pull model: ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.completed && json.total && onProgress) {
          const progress = (json.completed / json.total) * 100;
          onProgress(progress);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

/**
 * Delete a model from Ollama
 */
export async function deleteModel(modelName: string): Promise<void> {
  const response = await fetch(`${getOllamaBaseUrl()}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete model: ${response.status}`);
  }

  // Invalidate the models cache
  modelsCache.delete(getOllamaBaseUrl());
}

/**
 * Get detailed information about a specific model
 */
export async function getModelInfo(modelName: string): Promise<{
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
} | null> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export default {
  chatCompletion,
  generateEmbeddings,
  processDocument,
  generateTitle,
  checkOllamaHealth,
  getAvailableModels,
  pullModel,
  deleteModel,
  getModelInfo,
  FAST_MODELS,
};

// Export the helper functions for use in other modules
export { isReadableText };

