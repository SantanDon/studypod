import { type ReactElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), send: vi.fn(), getMessages: vi.fn() }));
vi.mock('@/hooks/useAuthState', () => ({ useAuthState: () => ({ user: { id: 'qa-owner' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'test-session' } }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ guestId: undefined }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { sendChatMessage: mocks.send, getChatMessages: mocks.getMessages } }));
vi.mock('@/services/chatAiService', () => ({ generateAIResponse: vi.fn() }));
vi.mock('@/lib/extraction/contentValidator', () => ({ validateCitations: vi.fn(), validateAIResponse: vi.fn() }));
import { useChatMessages } from '@/hooks/useChatMessages';

const clients: QueryClient[] = [];
const draft = { notebookId: 'owned-notebook', content: 'Explain the experiment', sourceIds: ['owned-source'], responseStyle: 'dense' as const };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useChatMessages(draft.notebookId), { wrapper });
}
function failure(status: number, code: string | undefined, message: string) {
  return Object.assign(new Error(message), { status, code });
}
beforeEach(() => {
  mocks.toast.mockReset();
  mocks.send.mockReset();
  mocks.getMessages.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

describe('signed-in chat failure and retry', () => {
  it.each([
    [503, 'PROVIDER_UNAVAILABLE', 'AI providers are temporarily unavailable.', 'AI Temporarily Unavailable', true],
    [503, 'DATABASE_TEMPORARILY_UNAVAILABLE', 'The notebook database is temporarily unavailable.', 'Notebook Temporarily Unavailable', true],
    [503, 'OTHER_SERVICE_UNAVAILABLE', 'Another service is unavailable.', 'Temporarily Unavailable', true],
    [503, undefined, 'Service temporarily unavailable.', 'Temporarily Unavailable', true],
    [503, undefined, 'PROVIDER_UNAVAILABLE', 'AI Temporarily Unavailable', true],
    [500, undefined, 'Source 503 failed processing', 'Error', false],
  ])('classifies status %s and code %s without claiming an unrelated provider outage', async (status, code, message, title, retry) => {
    mocks.send.mockRejectedValue(failure(status, code, message));
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow(message); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe(title);
    expect(!!toast.action).toBe(retry);
    if (title !== 'AI Temporarily Unavailable') expect(toast.description).not.toContain('AI providers are currently unreachable');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps offline guidance and retry when the network is disconnected', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.send.mockRejectedValue(new TypeError('Failed to fetch'));
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('Failed to fetch'); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe("You're Offline");
    expect(toast.description).toContain('Your draft is saved');
    expect(toast.action).toBeDefined();
  });

  it('retries the original long draft and selected sources after a database 503', async () => {
    const longDraft = { ...draft, content: 'Compare the evidence without omitting the final detail. '.repeat(1200) + 'Final detail: 17 blue trays.' };
    mocks.send.mockRejectedValueOnce(failure(503, 'DATABASE_TEMPORARILY_UNAVAILABLE', 'Database busy'))
      .mockResolvedValueOnce({ answer: 'The final detail is 17 blue trays.' });
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(longDraft)).rejects.toThrow('Database busy'); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe('Notebook Temporarily Unavailable');
    expect(toast.description).toContain('Your draft is still available');
    const retry = toast.action as ReactElement<{ onClick: () => void }>;
    act(() => retry.props.onClick());
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.isSending).toBe(false));
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0]);
    expect(mocks.send.mock.calls[1][1]).toEqual({ message: longDraft.content, sourceIds: ['owned-source'], responseStyle: 'dense', saveAsNote: undefined });
  });
});
