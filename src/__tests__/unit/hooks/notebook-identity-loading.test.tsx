import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotebooks } from '@/hooks/useNotebooks';

const state = vi.hoisted(() => ({
  loading: true, userId: null as string | null, guestId: null as string | null,
  cloud: vi.fn(), local: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ loading: state.loading, session: state.userId ? { access_token: 'COOKIE_SESSION' } : null }) }));
vi.mock('@/hooks/useAuthState', () => ({ useAuthState: () => ({ user: state.userId ? { id: state.userId } : null, isSignedIn: !!state.userId }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ guestId: state.guestId, isGuest: !!state.guestId, incrementUsage: vi.fn() }) }));
vi.mock('@/hooks/useSyncTrigger', () => ({ useSyncTrigger: () => ({ triggerSync: vi.fn() }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { fetchNotebooks: state.cloud } }));
vi.mock('@/integrations/local/localNotebookStore', () => ({ localNotebookStore: { getNotebooks: state.local } }));

const clients: QueryClient[] = [];
const open = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return renderHook(() => useNotebooks(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
};
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
beforeEach(() => {
  state.loading = true; state.userId = null; state.guestId = null;
  state.cloud.mockReset(); state.local.mockReset();
});

describe('notebook identity hydration', () => {
  it('keeps cold auth loading until the owner notebook request completes', async () => {
    let complete!: (rows: Record<string, unknown>[]) => void;
    state.cloud.mockReturnValue(new Promise<Record<string, unknown>[]>(resolve => { complete = resolve; }));
    const view = open();
    expect(view.result.current.isLoading).toBe(true);
    expect(state.cloud).not.toHaveBeenCalled();
    expect(state.local).not.toHaveBeenCalled();
    state.loading = false; state.userId = 'synthetic-owner';
    view.rerender();
    await waitFor(() => expect(state.cloud).toHaveBeenCalledOnce());
    expect(view.result.current.isLoading).toBe(true);
    await act(async () => complete([{ id: 'owned-notebook', userId: 'synthetic-owner', title: 'Synthetic notebook' }]));
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(view.result.current.notebooks[0].id).toBe('owned-notebook');
    expect(state.local).not.toHaveBeenCalled();
  });
  it('does not report a missing notebook between auth completion and guest identity initialization', async () => {
    state.loading = false;
    state.local.mockResolvedValue([{ id: 'guest-notebook', user_id: 'synthetic-guest' }]);
    const view = open();
    expect(view.result.current.isLoading).toBe(true);
    expect(state.local).not.toHaveBeenCalled();
    state.guestId = 'synthetic-guest';
    view.rerender();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(state.local).toHaveBeenCalledWith('synthetic-guest');
    expect(view.result.current.notebooks[0].id).toBe('guest-notebook');
  });
  it('settles loading when an initialized owner really has no notebooks', async () => {
    state.loading = false; state.userId = 'synthetic-owner';
    state.cloud.mockResolvedValue([]);
    const view = open();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(view.result.current.notebooks).toEqual([]);
  });
});
