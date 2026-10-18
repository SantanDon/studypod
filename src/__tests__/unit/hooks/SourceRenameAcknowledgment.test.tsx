import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '@/config/api';
import RenameSourceDialog from '@/components/notebook/RenameSourceDialog';
import { useSourceUpdate } from '@/hooks/useSourceUpdate';
import type { LocalSource } from '@/services/localStorageService';

const dependencies = vi.hoisted(() => ({
  session: { access_token: 'unit-test-session' } as { access_token: string } | null,
  toast: vi.fn(),
  localUpdate: vi.fn<(id: string, updates: Partial<LocalSource>) => LocalSource | null>(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: dependencies.session }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: dependencies.toast }) }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: { updateSource: dependencies.localUpdate } }));

const source: LocalSource = {
  id: 'owned-source', notebook_id: 'owned-notebook', title: 'Original title', type: 'text',
  created_at: '2026-10-12', updated_at: '2026-10-12',
};
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const response = (title: string) => new Response(JSON.stringify({ ...source, title }), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function ControlledDialog({ onClose }: { onClose: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return <RenameSourceDialog open={open} onOpenChange={next => { onClose(next); setOpen(next); }} source={source} notebookId={source.notebook_id} />;
}

beforeEach(() => {
  dependencies.session = { access_token: 'unit-test-session' };
  dependencies.toast.mockReset();
  dependencies.localUpdate.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('renames an authenticated owned source through PUT and invalidates only after acknowledgment without writing guest storage', async () => {
  const save = deferred<Response>();
  fetcher.mockReturnValue(save.promise);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useSourceUpdate(source.notebook_id), { wrapper });
  let pending!: ReturnType<typeof result.current.updateSource>;
  act(() => { pending = result.current.updateSource({ sourceId: source.id, title: 'Server title' }); });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledWith(`${API_BASE_URL}/notebooks/owned-notebook/sources/owned-source`, expect.objectContaining({
    method: 'PUT', credentials: 'include', body: JSON.stringify({ title: 'Server title' }),
  }));
  expect(invalidate).not.toHaveBeenCalled();
  expect(dependencies.toast).not.toHaveBeenCalled();
  expect(dependencies.localUpdate).not.toHaveBeenCalled();
  await act(async () => { save.resolve(response('Server title')); expect(await pending).toMatchObject({ title: 'Server title' }); });
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['sources', source.notebook_id] });
  expect(dependencies.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Source renamed' }));
  expect(dependencies.localUpdate).not.toHaveBeenCalled();
});

it('fails closed when an authenticated rename lacks notebook ownership context', async () => {
  const { result } = renderHook(() => useSourceUpdate(), { wrapper });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await act(async () => {
    await expect(result.current.updateSource({ sourceId: source.id, title: 'Draft' })).rejects.toThrow('Notebook required');
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(dependencies.localUpdate).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(dependencies.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error', variant: 'destructive' }));
});

it('keeps guest renames local without issuing an authenticated request', async () => {
  dependencies.session = null;
  dependencies.localUpdate.mockReturnValue({ ...source, title: 'Guest title' });
  const { result } = renderHook(() => useSourceUpdate(source.notebook_id), { wrapper });
  await act(async () => { await result.current.updateSource({ sourceId: source.id, title: 'Guest title' }); });
  expect(dependencies.localUpdate).toHaveBeenCalledExactlyOnceWith(source.id, { title: 'Guest title' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the dialog and draft visible while save is pending, closing only after server acknowledgment', async () => {
  const save = deferred<Response>();
  fetcher.mockReturnValue(save.promise);
  const onClose = vi.fn();
  render(<ControlledDialog onClose={onClose} />, { wrapper });
  fireEvent.change(screen.getByLabelText('Source Name *'), { target: { value: '  Acknowledged title  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled());
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByLabelText('Source Name *')).toHaveValue('  Acknowledged title  ');
  expect(onClose).not.toHaveBeenCalled();
  expect(dependencies.toast).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ title: 'Acknowledged title' }));
  await act(async () => { save.resolve(response('Acknowledged title')); await save.promise; });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  expect(dependencies.localUpdate).not.toHaveBeenCalled();
});

it('retains an editable draft after a rejected save and allows a corrected retry without closing early', async () => {
  const retry = deferred<Response>();
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockReturnValueOnce(retry.promise);
  const onClose = vi.fn();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<ControlledDialog onClose={onClose} />, { wrapper });
  fireEvent.change(screen.getByLabelText('Source Name *'), { target: { value: 'Failed draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(dependencies.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error', variant: 'destructive' })));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByLabelText('Source Name *')).toHaveValue('Failed draft');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(onClose).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Source Name *'), { target: { value: 'Corrected retry' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ title: 'Corrected retry' }));
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  expect(onClose).not.toHaveBeenCalled();
  expect(dependencies.localUpdate).not.toHaveBeenCalled();
  await act(async () => { retry.resolve(response('Corrected retry')); await retry.promise; });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['sources', source.notebook_id] });
  expect(dependencies.toast).toHaveBeenCalledTimes(2);
});
