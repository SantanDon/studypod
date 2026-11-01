import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '@/services/apiService';
import { clearPersonalProviderConnection, connectPersonalProvider } from '@/lib/ai/personalProviderContext';

afterEach(() => {
  clearPersonalProviderConnection();
  vi.unstubAllGlobals();
});

describe('ApiService personal provider routing', () => {
  it('sends the selected provider to notebook chat without putting the key in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'Answer' }) });
    vi.stubGlobal('fetch', fetchMock);
    connectPersonalProvider('gemini', 'gemini-secret', 'gemini-test');

    await ApiService.sendChatMessage('notebook-1', { message: 'Question' }, 'session-token');

    expect(fetchMock).toHaveBeenCalledWith('/api/notebooks/notebook-1/chat', expect.objectContaining({
      headers: expect.objectContaining({
        'X-StudyPod-Provider': 'gemini',
        'X-StudyPod-Api-Key': 'gemini-secret',
        'X-StudyPod-Model': 'gemini-test',
      }),
      body: JSON.stringify({ message: 'Question' }),
    }));
    expect(fetchMock.mock.calls[0][1].body).not.toContain('gemini-secret');
  });
});
