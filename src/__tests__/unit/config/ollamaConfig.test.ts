import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

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
  vi.stubEnv('VITE_ENABLE_OLLAMA', flag);
  const config = await import('@/config/ollamaConfig');
  expect(config.isOllamaEnabled()).toBe(enabled);
  expect(config.OLLAMA_ENABLED).toBe(enabled);
  expect(config.default).toBe(enabled);
});
