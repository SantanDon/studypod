export type PersonalProvider = 'groq' | 'gemini';

export interface PersonalProviderConnection {
  provider: PersonalProvider;
  model?: string;
}

interface ActiveConnection extends PersonalProviderConnection {
  apiKey: string;
}

let activeConnection: ActiveConnection | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Personal provider credentials intentionally live only in this page's JS memory. */
export function connectPersonalProvider(provider: PersonalProvider, apiKey: string, model?: string) {
  const key = apiKey.trim();
  if (!key) throw new Error('Enter a provider API key first.');
  activeConnection = { provider, apiKey: key, ...(model?.trim() ? { model: model.trim() } : {}) };
  notify();
}

export function clearPersonalProviderConnection() {
  activeConnection = null;
  notify();
}

export function getPersonalProviderConnection(): PersonalProviderConnection | null {
  if (!activeConnection) return null;
  return { provider: activeConnection.provider, ...(activeConnection.model ? { model: activeConnection.model } : {}) };
}

export function getPersonalProviderRequestHeaders(): Record<string, string> {
  if (!activeConnection) return {};
  return {
    'X-StudyPod-Provider': activeConnection.provider,
    'X-StudyPod-Api-Key': activeConnection.apiKey,
    ...(activeConnection.model ? { 'X-StudyPod-Model': activeConnection.model } : {}),
  };
}

export function subscribePersonalProvider(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Prevent a provider error from reflecting the in-memory key into visible UI. */
export function redactPersonalProviderKey(message: string, additionalSensitiveKey?: string): string {
  const keys = [activeConnection?.apiKey, additionalSensitiveKey].filter((key): key is string => Boolean(key));
  return keys.reduce((safeMessage, key) => safeMessage.split(key).join('[redacted]'), message);
}
