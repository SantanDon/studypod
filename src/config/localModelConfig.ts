export type LocalModelProvider = "ollama" | "lm-studio" | "custom";
export interface LocalModelSettings {
  provider: LocalModelProvider;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

const STORAGE_KEY = "studypod.localModel.settings.v1";
const DEFAULTS: LocalModelSettings = { provider: "ollama", baseUrl: "http://localhost:11434", model: "", enabled: false };
let sessionApiKey = "";

export function normalizeLocalModelUrl(value: string, provider: LocalModelProvider): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Endpoint must be a valid absolute HTTP(S) URL"); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("Endpoint must use HTTP(S) and cannot contain credentials");
  if (url.search || url.hash) throw new Error("Endpoint cannot contain a query string or fragment");
  let path = url.pathname.replace(/\/+$/, "");
  if (provider !== "ollama" && !path.endsWith("/v1")) path = `${path}/v1`;
  return `${url.origin}${path}`;
}

export function getLocalModelSettings(): LocalModelSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const value = JSON.parse(raw) as Partial<LocalModelSettings>;
    const provider = value.provider === "lm-studio" || value.provider === "custom" ? value.provider : "ollama";
    return {
      provider,
      baseUrl: normalizeLocalModelUrl(typeof value.baseUrl === "string" ? value.baseUrl : DEFAULTS.baseUrl, provider),
      model: typeof value.model === "string" ? value.model.trim().slice(0, 256) : "",
      enabled: value.enabled === true,
    };
  } catch { return { ...DEFAULTS }; }
}

export function saveLocalModelSettings(update: Partial<LocalModelSettings>): LocalModelSettings {
  const current = getLocalModelSettings();
  const provider = update.provider ?? current.provider;
  const defaults = provider === "lm-studio" ? "http://localhost:1234/v1" : provider === "custom" ? "http://localhost:8000/v1" : DEFAULTS.baseUrl;
  const next: LocalModelSettings = {
    provider,
    baseUrl: normalizeLocalModelUrl(update.baseUrl ?? (provider !== current.provider ? defaults : current.baseUrl), provider),
    model: (update.model ?? (provider !== current.provider ? "" : current.model)).trim().slice(0, 256),
    enabled: update.enabled ?? (provider === current.provider ? current.enabled : false),
  };
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Credentials live only in this page session; they are never persisted. */
export function setLocalModelApiKey(key: string): void { sessionApiKey = key.trim(); }
export function getLocalModelApiKey(): string { return sessionApiKey; }
export function isCompatibleLocalModelSelected(): boolean {
  const settings = getLocalModelSettings();
  return settings.enabled && settings.provider !== "ollama";
}
