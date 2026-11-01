import { getLocalModelApiKey, getLocalModelSettings } from "@/config/localModelConfig";

const COMPATIBLE_CHAT_MAX_CHARS = 20_000;
const COMPATIBLE_CHAT_TIMEOUT_MS = 120_000;
const COMPATIBLE_CHAT_MAX_TOKENS = 1024;
const COMPATIBLE_CHAT_EMPTY_RETRY_MAX_TOKENS = 4096;
const TRUNCATION_MARKER = "\n[Earlier context shortened to fit the local model prompt.]\n";
const EMPTY_RETRY_INSTRUCTION = "Answer the user's latest question directly and concisely using the supplied evidence. Do not output internal reasoning; provide only the final answer.";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Bound chat context without flattening role semantics or dropping the latest question. */
export function boundCompatibleChatMessages(messages: ChatMessage[], maxChars = COMPATIBLE_CHAT_MAX_CHARS): ChatMessage[] {
  const latestUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : undefined;
  const systems = messages.filter((message) => message.role === "system");
  const history = messages.filter((message, index) => message.role !== "system" && index !== latestUserIndex);
  const separatorCost = Math.max(0, systems.length + (latestUser ? 1 : 0) - 1) * 2;
  const latestBudget = Math.min(latestUser?.content.length ?? 0, Math.max(0, maxChars - separatorCost));
  const latestContent = latestUser?.content ?? "";
  const latestBoundedContent = latestContent.length <= latestBudget
    ? latestContent
    : latestBudget > TRUNCATION_MARKER.length
      ? (() => {
        const edgeBudget = latestBudget - TRUNCATION_MARKER.length;
        const headLength = Math.ceil(edgeBudget / 2);
        const tailLength = edgeBudget - headLength;
        return `${latestContent.slice(0, headLength)}${TRUNCATION_MARKER}${tailLength ? latestContent.slice(-tailLength) : ""}`;
      })()
      : latestBudget > 1
        ? `${latestContent.slice(0, Math.ceil(latestBudget / 2))}${latestContent.slice(-Math.floor(latestBudget / 2))}`
        : latestContent.slice(0, latestBudget);
  const latest = latestUser && latestBudget > 0
    ? [{ ...latestUser, content: latestBoundedContent }]
    : [];
  let remaining = Math.max(0, maxChars - latest.reduce((sum, message) => sum + message.content.length, 0) - separatorCost);
  const boundedSystems: ChatMessage[] = [];
  for (const message of systems) {
    if (remaining <= 0) break;
    const take = Math.min(message.content.length, remaining);
    const content = take < message.content.length
      ? take > TRUNCATION_MARKER.length
        ? `${message.content.slice(0, take - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
        : message.content.slice(0, take)
      : message.content;
    boundedSystems.push({ ...message, content });
    remaining -= content.length;
  }
  const boundedHistory: ChatMessage[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.content.length + 2 > remaining) break;
    boundedHistory.unshift(message);
    remaining -= message.content.length + 2;
  }
  return [...boundedSystems, ...boundedHistory, ...latest];
}

export interface LocalModelCheck { ok: boolean; models: string[]; message: string; }
function headers(): Record<string, string> {
  const key = getLocalModelApiKey();
  return { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

/** Ollama's OpenAI-compatible API uses reasoning_effort (not native `think`). */
function isOllamaCompatibleEndpoint(baseUrl: string): boolean {
  try { return new URL(baseUrl).port === "11434"; } catch { return false; }
}

export async function discoverCompatibleModels(signal?: AbortSignal): Promise<string[]> {
  const settings = getLocalModelSettings();
  if (settings.provider === "ollama") throw new Error("Use Ollama model discovery for the Ollama provider");
  const response = await fetch(`${settings.baseUrl}/models`, { headers: headers(), signal });
  if (!response.ok) throw new Error(`Model discovery failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  const models = Array.isArray(body.data) ? body.data.flatMap((item) => typeof item.id === "string" ? [item.id] : []) : [];
  if (!models.length) throw new Error("Endpoint responded, but returned no OpenAI-compatible models");
  return models;
}

export async function checkCompatibleLocalModel(signal?: AbortSignal): Promise<LocalModelCheck> {
  try {
    const models = await discoverCompatibleModels(signal);
    return { ok: true, models, message: `Connected; found ${models.length} model${models.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, models: [], message: error instanceof Error ? error.message : String(error) };
  }
}

export async function completeCompatibleLocalChat(args: {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  const settings = getLocalModelSettings();
  if (settings.provider === "ollama") throw new Error("The selected provider is Ollama, not OpenAI-compatible");
  if (!args.model.trim()) throw new Error("Select an installed local model before generating");
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(args.signal?.reason);
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (args.signal?.aborted) abortFromCaller();
  const timeout = setTimeout(() => controller.abort(new DOMException("Local model generation timed out", "TimeoutError")), COMPATIBLE_CHAT_TIMEOUT_MS);
  const ollamaCompatible = isOllamaCompatibleEndpoint(settings.baseUrl);
  try {
    const request = async (messages: ChatMessage[], maxTokens: number): Promise<string> => {
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: args.model,
          messages: boundCompatibleChatMessages(messages),
          temperature: args.temperature ?? 0.7,
          max_tokens: maxTokens,
          ...(args.jsonMode ? { response_format: { type: "json_object" } } : {}),
          stream: Boolean(args.onChunk),
          ...(ollamaCompatible ? { reasoning_effort: "none" } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Local model generation failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
      if (!args.onChunk) {
        const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = body.choices?.[0]?.message?.content;
        return typeof content === "string" ? content : "";
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Local model response did not include a stream");
      const decoder = new TextDecoder();
      let buffer = ""; let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const data = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: unknown } }> };
            const content = data.choices?.[0]?.delta?.content;
            if (typeof content === "string") { full += content; args.onChunk(content); }
          } catch { /* ignore malformed SSE frames */ }
        }
      }
      return full;
    };

    const first = await request(args.messages, args.maxOutputTokens ?? COMPATIBLE_CHAT_MAX_TOKENS);
    if (first.trim()) return first;
    const retryMessages: ChatMessage[] = [{ role: "system", content: EMPTY_RETRY_INSTRUCTION }, ...args.messages];
    const retry = await request(retryMessages, args.maxOutputTokens ?? COMPATIBLE_CHAT_EMPTY_RETRY_MAX_TOKENS);
    if (retry.trim()) return retry;
    throw new Error("Local model returned an empty completion after one bounded retry");
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abortFromCaller);
  }
}
