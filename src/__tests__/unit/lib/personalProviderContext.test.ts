import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersonalProviderConnection,
  connectPersonalProvider,
  getPersonalProviderConnection,
  getPersonalProviderRequestHeaders,
} from '@/lib/ai/personalProviderContext';

afterEach(() => {
  clearPersonalProviderConnection();
  vi.restoreAllMocks();
});

describe('personal provider tab-memory connection', () => {
  it('keeps the key out of metadata and browser storage, and removes request headers on disconnect', () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    connectPersonalProvider('gemini', 'secret-key-123', 'gemini-test');

    expect(getPersonalProviderConnection()).toEqual({ provider: 'gemini', model: 'gemini-test' });
    expect(getPersonalProviderRequestHeaders()).toEqual({
      'X-StudyPod-Provider': 'gemini',
      'X-StudyPod-Api-Key': 'secret-key-123',
      'X-StudyPod-Model': 'gemini-test',
    });
    expect(storageWrite).not.toHaveBeenCalled();

    clearPersonalProviderConnection();
    expect(getPersonalProviderRequestHeaders()).toEqual({});
  });

  it('starts disconnected after a page module reload', async () => {
    connectPersonalProvider('groq', 'secret-key-456');
    vi.resetModules();

    const freshContext = await import('@/lib/ai/personalProviderContext');
    expect(freshContext.getPersonalProviderConnection()).toBeNull();
    expect(freshContext.getPersonalProviderRequestHeaders()).toEqual({});
  });
});
