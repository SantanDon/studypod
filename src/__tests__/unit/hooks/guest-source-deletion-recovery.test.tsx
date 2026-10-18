import { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestProvider } from '@/contexts/GuestContext';
import { useGuest, useNotebookLimits } from '@/hooks/useGuest';
import { useSourceDelete } from '@/hooks/useSourceDelete';
import { getInitialUsage } from '@/lib/utils/contextUtils';

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: false, loading: false, session: null as null | { access_token: string } },
  getSource: vi.fn(), deleteLocal: vi.fn(), deleteCloud: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/stores/encryptionStore', () => ({ useEncryptionStore: () => ({ isUnlocked: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: {
  getSourceById: mocks.getSource, deleteSource: mocks.deleteLocal,
} }));
vi.mock('@/services/apiService', () => ({ ApiService: { deleteSource: mocks.deleteCloud } }));

function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><GuestProvider>{children}</GuestProvider></QueryClientProvider>
  );
  return renderHook(() => ({ guest: useGuest(), limits: useNotebookLimits('notebook'), deletion: useSourceDelete() }), { wrapper });
}

describe('guest source deletion restores replacement quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth = { isAuthenticated: false, loading: false, session: null };
    mocks.getSource.mockReturnValue({ id: 'failed-source', notebook_id: 'notebook', title: 'Corrupt PDF', processing_status: 'failed' });
    mocks.deleteLocal.mockReturnValue(true);
    mocks.deleteCloud.mockResolvedValue(undefined);
    localStorage.setItem('guest_id', 'guest_test');
    localStorage.setItem('guest_mode_data', JSON.stringify({
      usage: { ...getInitialUsage(), sources: 5, messages: 7 },
      notebookUsage: { notebook: { sources: 5, messages: 7 } },
    }));
  });
  afterEach(cleanup);

  it('successful deletion of a failed source restores one slot and survives provider reload', async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.limits.sourcesRemaining).toBe(0));
    act(() => first.result.current.deletion.deleteSource({ notebookId: 'notebook', sourceId: 'failed-source' }));
    await waitFor(() => expect(first.result.current.limits.sourcesRemaining).toBe(1));
    expect(first.result.current.limits.canAddSource).toBe(true);
    expect(first.result.current.guest.usage.sources).toBe(4);
    expect(first.result.current.guest.getNotebookUsage('notebook').messages).toBe(7);
    first.unmount();
    const reloaded = mount();
    await waitFor(() => expect(reloaded.result.current.guest.isGuest).toBe(true));
    expect(reloaded.result.current.limits.sourcesRemaining).toBe(1);
    expect(reloaded.result.current.guest.usage.sources).toBe(4);
  });

  it('failed local deletion retains the limit, including after reload', async () => {
    mocks.deleteLocal.mockReturnValue(false);
    const first = mount();
    await waitFor(() => expect(first.result.current.guest.isGuest).toBe(true));
    act(() => first.result.current.deletion.deleteSource({ notebookId: 'notebook', sourceId: 'failed-source' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' })));
    expect(first.result.current.limits.sourcesRemaining).toBe(0);
    first.unmount();
    const reloaded = mount();
    await waitFor(() => expect(reloaded.result.current.guest.isGuest).toBe(true));
    expect(reloaded.result.current.limits.canAddSource).toBe(false);
    expect(reloaded.result.current.guest.usage.sources).toBe(5);
  });

  it('bounds global and notebook source counts at zero without touching message counts', async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.guest.isGuest).toBe(true));
    act(() => { for (let i = 0; i < 8; i++) hook.result.current.guest.releaseSourceSlot('notebook'); });
    expect(hook.result.current.guest.usage.sources).toBe(0);
    expect(hook.result.current.guest.getNotebookUsage('notebook')).toEqual({ sources: 0, messages: 7 });
    expect(hook.result.current.guest.usage.messages).toBe(7);
  });

  it('cloud deletion never releases guest slots or deletes locally', async () => {
    // Exercise the cloud branch while guest state remains present, so an accidental release is observable.
    mocks.auth.session = { access_token: 'test-only-session' };
    const hook = mount();
    await waitFor(() => expect(hook.result.current.guest.isGuest).toBe(true));
    act(() => hook.result.current.deletion.deleteSource({ notebookId: 'notebook', sourceId: 'failed-source' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Source deleted' })));
    expect(mocks.deleteCloud).toHaveBeenCalledOnce();
    expect(mocks.deleteLocal).not.toHaveBeenCalled();
    expect(hook.result.current.guest.usage.sources).toBe(5);
    expect(hook.result.current.limits.sourcesRemaining).toBe(0);
  });
});
