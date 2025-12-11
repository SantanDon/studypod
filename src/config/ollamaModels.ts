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

export function getModelForTask(task: OllamaTask): string {
  return ollamaModelMap[task] ?? ollamaModelMap.chat;
}
