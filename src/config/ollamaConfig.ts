const RUNTIME_OPT_IN_KEY = "studypod.localInference.enabled";
const RUNTIME_BASE_URL_KEY = "studypod.localInference.baseUrl";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function envValue(...names: string[]): string | undefined {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  for (const name of names) {
    const processEnv = typeof process !== "undefined" ? process.env : undefined;
    const value = processEnv && Object.prototype.hasOwnProperty.call(processEnv, name)
      ? processEnv[name]
      : viteEnv?.[name];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function normalizeOllamaBaseUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Ollama endpoint must be a valid absolute HTTP(S) URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("Ollama endpoint must use HTTP(S) and cannot contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Ollama endpoint cannot contain a query string or fragment");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** Resolve every frontend Ollama call through the same configured endpoint. */
export function getOllamaBaseUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const runtimeUrl = window.localStorage.getItem(RUNTIME_BASE_URL_KEY);
      if (runtimeUrl) return normalizeOllamaBaseUrl(runtimeUrl);
    } catch {
      // Continue with the build-time endpoint when browser storage is unavailable.
    }
  }
  return normalizeOllamaBaseUrl(
    envValue("VITE_OLLAMA_URL", "VITE_OLLAMA_BASE_URL", "VITE_OLLAMA_BASE", "OLLAMA_BASE_URL") || DEFAULT_OLLAMA_BASE_URL,
  );
}

/** Persist a validated endpoint in this browser, or clear it with null. */
export function setRuntimeOllamaBaseUrl(value: string | null): void {
  if (typeof window === "undefined") return;
  if (value === null || value.trim() === "") {
    window.localStorage.removeItem(RUNTIME_BASE_URL_KEY);
    return;
  }
  const normalized = normalizeOllamaBaseUrl(value);
  window.localStorage.setItem(RUNTIME_BASE_URL_KEY, normalized);
}

/** Runtime opt-in is intentionally explicit and stored locally in this browser. */
export function setRuntimeOllamaEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  // Persist both values: false must override a build-time opt-in on hosted apps.
  window.localStorage.setItem(RUNTIME_OPT_IN_KEY, String(enabled));
}

export function isOllamaEnabled(localOnly = false): boolean {
  if (localOnly) return true;
  if (typeof window !== "undefined") {
    try {
      const runtimePreference = window.localStorage.getItem(RUNTIME_OPT_IN_KEY);
      if (runtimePreference === "true") return true;
      if (runtimePreference === "false") return false;
    } catch {
      // If storage cannot be read, retain the build-time behavior.
    }
  }
  const flag = envValue("VITE_ENABLE_OLLAMA");
  if (flag === "1" || flag === "true") return true;
  return false;
}

export const OLLAMA_ENABLED = isOllamaEnabled();
export default OLLAMA_ENABLED;
