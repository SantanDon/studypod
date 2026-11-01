/*
 * Ollama Model Configuration
 *
 * This file provides a simple mapping between high‑level AI tasks and the
 * Ollama model identifiers that best fit that task on a local instance.
 *
 * To add or change a mapping:
 * 1. Add or modify a line in `ollamaModelMap`.
 * 2. Export `getModelForTask` to resolve a model name from a task string.
 *
 * The mapping below is based on the custom models configuration
 * defined in ollamaService.ts
 */

export type OllamaTask =
  | "chat"
  | "summarize"
  | "image"
  | "code"
  | "embeddings"
  | "text"
  | "title";

export const ollamaModelMap: Record<OllamaTask, string> = {
  // Chat / conversational AI
  chat: "llama3.2:1b",
  // Summarization of long text
  summarize: "llama3.2:1b",
  // Image generation / multimodal tasks
  image: "llama3.2:1b",
  // Code generation / refactoring
  code: "phi:2.7b",
  // Embedding generation for semantic search
  embeddings: "dengcao/Qwen3-Embedding-0.6B:Q8_0",
  // General text generation or transformation
  text: "llama3.2:1b",
  // Title generation
  title: "llama3.2:1b",
};

/** Return a valid browser-selected model without applying build/default fallbacks. */
export function getRuntimeModelForTask(task: OllamaTask): string | undefined {
  // Settings stores per-purpose choices in this browser-local record. Read it
  // at call time so changes made after module load affect the next request.
  // Treat storage as untrusted (it may be stale, malformed, or unavailable).
  const settingKey = task === "embeddings" ? "embedding" : task === "code" ? "code" : "chat";
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("ollama-default-models");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const candidate = (parsed as Record<string, unknown>)[settingKey];
          if (typeof candidate === "string") {
            const model = candidate.trim();
            if (model.length > 0 && model.length <= 256 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?::[A-Za-z0-9_.-]+)?$/.test(model)) {
              return model;
            }
          }
        }
      }
    }
  } catch {
    // Fall back to the built-in mapping when browser storage is inaccessible.
  }

  return undefined;
}

export function getModelForTask(task: OllamaTask): string {
  const runtimeModel = getRuntimeModelForTask(task);
  if (runtimeModel) return runtimeModel;

  // A browser selection is an explicit runtime choice, so it takes precedence
  // over the build-time default. Embeddings still use their dedicated model.
  const configuredModel = import.meta.env.VITE_OLLAMA_MODEL?.trim();
  if (task !== "embeddings" && configuredModel) return configuredModel;

  return ollamaModelMap[task] ?? ollamaModelMap.chat;
}
