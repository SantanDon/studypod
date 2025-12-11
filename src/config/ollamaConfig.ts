// Centralized Ollama enablement config
// Use Vite env `VITE_ENABLE_OLLAMA=1` or `VITE_ENABLE_OLLAMA=true` to enable Ollama in the frontend.
// Also accepts `OLLAMA_ENABLED` in Node envs for server-side code.

function readEnvValue(): string | undefined {
  // Vite-style import.meta.env when running in the browser/dev with Vite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viteEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;

  if (viteEnv && (viteEnv.VITE_ENABLE_OLLAMA !== undefined)) {
    return viteEnv.VITE_ENABLE_OLLAMA;
  }

  // Fallback to process.env for Node contexts
  if (typeof process !== 'undefined') {
    return process.env.OLLAMA_ENABLED || process.env.VITE_ENABLE_OLLAMA;
  }

  return undefined;
}

export function isOllamaEnabled(): boolean {
  const val = readEnvValue();
  if (!val) return false;
  const normalized = String(val).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export const OLLAMA_ENABLED = isOllamaEnabled();

export default OLLAMA_ENABLED;
