import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { window.localStorage.clear(); vi.stubEnv('VITE_ENABLE_OLLAMA', 'false'); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); window.localStorage.clear(); vi.resetModules(); });

it.each([
  { label: 'unset', flag: undefined, enabled: false },
  { label: 'false', flag: 'false', enabled: false },
  { label: 'zero', flag: '0', enabled: false },
  { label: 'empty', flag: '', enabled: false },
  { label: 'true', flag: 'true', enabled: true },
  { label: 'one', flag: '1', enabled: true },
  { label: 'uppercase TRUE', flag: 'TRUE', enabled: false },
  { label: 'arbitrary truthy string', flag: 'enabled', enabled: false },
])('uses explicit frontend opt-in for $label', async ({ flag, enabled }) => {
  vi.stubEnv('VITE_ENABLE_OLLAMA', flag ?? '');
  const config = await import('@/config/ollamaConfig');
  expect(config.isOllamaEnabled()).toBe(enabled);
  expect(config.OLLAMA_ENABLED).toBe(enabled);
  expect(config.default).toBe(enabled);
});

it('resolves the shared Ollama endpoint from the canonical URL aliases', async () => {
  vi.stubEnv('VITE_OLLAMA_URL', 'http://ollama.example:11434///');
  const config = await import('@/config/ollamaConfig');
  expect(config.getOllamaBaseUrl()).toBe('http://ollama.example:11434');
});

it('lets hosted settings override the endpoint at runtime and clear the override', async () => {
  vi.stubEnv('VITE_OLLAMA_URL', 'http://build.example:11434');
  const config = await import('@/config/ollamaConfig');
  config.setRuntimeOllamaBaseUrl('https://local.example:11434///');
  expect(config.getOllamaBaseUrl()).toBe('https://local.example:11434');
  config.setRuntimeOllamaBaseUrl(null);
  expect(config.getOllamaBaseUrl()).toBe('http://build.example:11434');
});

it.each([
  'javascript:alert(1)',
  'ftp://localhost:11434',
  'http://user:pass@localhost:11434',
  'http://localhost:11434?token=secret',
  'not a url',
])('rejects unsafe runtime endpoint %s', async (endpoint) => {
  const config = await import('@/config/ollamaConfig');
  expect(() => config.setRuntimeOllamaBaseUrl(endpoint)).toThrow();
});

it('supports explicit browser runtime opt-in while keeping the default disabled', async () => {
  const config = await import('@/config/ollamaConfig');
  expect(config.isOllamaEnabled()).toBe(false);
  config.setRuntimeOllamaEnabled(true);
  expect(config.isOllamaEnabled()).toBe(true);
  config.setRuntimeOllamaEnabled(false);
  expect(config.isOllamaEnabled()).toBe(false);
});

it('lets an explicit runtime disable override a build-time opt-in', async () => {
  vi.stubEnv('VITE_ENABLE_OLLAMA', 'true');
  const config = await import('@/config/ollamaConfig');
  expect(config.isOllamaEnabled()).toBe(true);
  config.setRuntimeOllamaEnabled(false);
  expect(config.isOllamaEnabled()).toBe(false);
  expect(config.isOllamaEnabled(true)).toBe(true);
  config.setRuntimeOllamaEnabled(true);
  expect(config.isOllamaEnabled()).toBe(true);
});

it('allows a request-scoped local-only choice without enabling local inference globally', async () => {
  const config = await import('@/config/ollamaConfig');
  expect(config.isOllamaEnabled(true)).toBe(true);
  expect(config.isOllamaEnabled()).toBe(false);
});
