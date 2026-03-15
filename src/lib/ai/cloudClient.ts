/**
 * Cloud HTTP Client for Groq and Voyage AI Fallbacks
 * Used when VITE_ENABLE_OLLAMA is false or offline.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";

interface ViteEnv { VITE_GROQ_API_KEY?: string; VITE_VOYAGE_API_KEY?: string; }
const getViteEnv = (): ViteEnv | undefined =>
  typeof import.meta !== "undefined" ? (import.meta as unknown as { env: ViteEnv }).env : undefined;

export const getGroqApiKey = () => {
  const viteEnv = getViteEnv();
  return viteEnv?.VITE_GROQ_API_KEY || (typeof process !== "undefined" ? process.env?.VITE_GROQ_API_KEY : undefined);
};

export const getVoyageApiKey = () => {
  const viteEnv = getViteEnv();
  return viteEnv?.VITE_VOYAGE_API_KEY || (typeof process !== "undefined" ? process.env?.VITE_VOYAGE_API_KEY : undefined);
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generate chat completions via Groq (Llama 3)
 */
export async function generateGroqResponse(messages: ChatMessage[], model: string = "llama-3.1-8b-instant", temperature: number = 0.7): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("Missing VITE_GROQ_API_KEY for cloud fallback.");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // ── Rate-limit: parse the retry-after duration from the Groq error body ──
    if (response.status === 429) {
      // Groq embeds "Please try again in 10.82s" inside the error JSON message
      const secondsMatch = errorText.match(/try again in ([\d.]+)s/i);
      const retryAfterSeconds = secondsMatch ? Math.ceil(parseFloat(secondsMatch[1])) : null;

      const err = new Error(`rate_limit_exceeded${retryAfterSeconds != null ? `:${retryAfterSeconds}` : ''}`);
      (err as Error & { retryAfterSeconds: number | null }).retryAfterSeconds = retryAfterSeconds;
      throw err;
    }

    throw new Error(`Groq API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Generate embeddings via Voyage AI
 */
export async function generateVoyageEmbeddings(text: string, model: string = "voyage-3-lite"): Promise<number[]> {
  const apiKey = getVoyageApiKey();
  if (!apiKey) {
    // No Voyage key configured — return empty embeddings so callers fall back to keyword search
    console.warn("⚠️ VITE_VOYAGE_API_KEY not set — returning empty embeddings, keyword search will be used.");
    return [];
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voyage API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}
