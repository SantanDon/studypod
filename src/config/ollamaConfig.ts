// Centralized Ollama enablement config
// Use Vite env `VITE_ENABLE_OLLAMA=1` or `VITE_ENABLE_OLLAMA=true` to enable Ollama in the frontend.

export function isOllamaEnabled(): boolean {
  // Local inference remains opt-in, including in self-hosted builds.
  const flag = import.meta.env.VITE_ENABLE_OLLAMA;
  return flag === "1" || flag === "true";
}

export const OLLAMA_ENABLED = isOllamaEnabled();

export default OLLAMA_ENABLED;
