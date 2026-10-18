import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ owner: 'account:a', ready: true, authenticated: true, fetch: vi.fn(), create: vi.fn() }));
vi.mock('@/services/apiService', () => ({ ApiService: { fetchTasks: state.fetch, createTask: state.create } }));
vi.mock('@/services/studioApiService', () => ({ useStudioIdentity: () => {
  const owner = state.owner;
  return { owner, ready: state.ready, authenticated: state.authenticated, token: undefined,
    assertCurrent: () => { if (owner !== state.owner || !state.ready) throw new Error('Account changed'); } };
} }));
import { useTasks } from '@/hooks/useTasks';
const row = { id: 'task-a', notebookId: 'book', userId: 'a', content: '17 trays', status: 'pending', priority: 'medium', createdAt: '', updatedAt: '' };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useTasks('book'), { wrapper }) };
}
beforeEach(() => { state.owner = 'account:a'; state.ready = true; state.authenticated = true; state.fetch.mockReset().mockResolvedValue([row]); state.create.mockReset().mockResolvedValue({ task: row }); });
afterEach(cleanup);
describe('owner-scoped saved tasks', () => {
  it('normalizes server notebook identity and prevents cached tasks crossing accounts', async () => {
    const view = setup(); await waitFor(() => expect(view.result.current.tasks?.[0].notebook_id).toBe('book'));
    state.owner = 'account:b'; state.fetch.mockResolvedValue([]); view.rerender();
    expect(view.result.current.tasks).toBeUndefined();
    await waitFor(() => expect(view.result.current.tasks).toEqual([]));
    expect(view.client.getQueryData(['tasks', 'book', 'account:a'])).toHaveLength(1);
    view.client.clear();
  });
  it('does not fetch before authentication settles or for a guest', async () => {
    state.ready = false; const view = setup(); expect(view.result.current.isLoading).toBe(true);
    expect(state.fetch).not.toHaveBeenCalled();
    state.ready = true; state.authenticated = false; view.rerender();
    expect(view.result.current.tasks).toBeUndefined(); expect(state.fetch).not.toHaveBeenCalled();
    await expect(view.result.current.createTaskAsync({ content: 'study' })).rejects.toThrow('Sign in');
    expect(state.create).not.toHaveBeenCalled(); view.client.clear();
  });
  it('refetches the captured owner query immediately after a successful save', async () => {
    const view = setup(); await waitFor(() => expect(view.result.current.tasks).toHaveLength(1));
    state.fetch.mockResolvedValue([{ ...row, id: 'saved', content: 'saved full answer' }]);
    await act(async () => { await view.result.current.createTaskAsync({ content: 'saved full answer' }); });
    await waitFor(() => expect(view.result.current.tasks?.[0].id).toBe('saved'));
    expect(state.create).toHaveBeenCalledWith('book', 'saved full answer', 'medium', 'COOKIE_SESSION'); view.client.clear();
  });
  it('rejects completion after the account changes and does not refresh the new owner', async () => {
    let finish!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = setup(); await waitFor(() => expect(view.result.current.tasks).toHaveLength(1));
    const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    const pending = view.result.current.createTaskAsync({ content: 'old owner answer' });
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    state.owner = 'account:b'; finish({ task: row });
    await expect(pending).rejects.toThrow('Account changed'); expect(invalidate).not.toHaveBeenCalled(); view.client.clear();
  });
  it('surfaces malformed saved records as a recoverable read error', async () => {
    state.fetch.mockResolvedValue([{ id: 'broken' }]); const view = setup();
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.tasks).toBeUndefined();
    state.fetch.mockResolvedValue([row]); await act(async () => { await view.result.current.refetch(); });
    await waitFor(() => expect(view.result.current.tasks).toHaveLength(1)); view.client.clear();
  });
});
