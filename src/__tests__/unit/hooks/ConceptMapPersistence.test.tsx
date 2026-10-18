import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConceptMap } from '@/hooks/useConceptMap';
import type { ConceptMap } from '@/types/conceptMap';

const state = vi.hoisted(() => ({
  user: { id: 'owner' } as { id: string } | null,
  generate: vi.fn<() => Promise<Pick<ConceptMap, 'nodes' | 'edges'>>>(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, loading: false, session: state.user ? { access_token: 'COOKIE_SESSION' } : null }) }));
vi.mock('@/lib/conceptMap/conceptMapGenerator', () => ({ generateConceptMap: state.generate }));

const graph: Pick<ConceptMap, 'nodes' | 'edges'> = { nodes: [{ id: 'root', label: 'Cedar', type: 'main' }], edges: [] };
const saved: ConceptMap = { id: 'server-map', notebookId: 'book', title: 'Cedar', ...graph, createdAt: '2026-10-13', updatedAt: '2026-10-13' };
const input = { content: 'Cedar has leaves', title: 'Cedar', notebookId: 'book' };
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear(); state.user = { id: 'owner' };
  state.generate.mockReset(); state.generate.mockResolvedValue(graph);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetcher = vi.fn<typeof fetch>(); fetcher.mockImplementation(async () => response({ maps: [] }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('waits for authenticated server acknowledgment and never saves account maps into guest storage', async () => {
  const save = deferred<Response>(); let maps: ConceptMap[] = [];
  fetcher.mockImplementation(async (_url, options) => options?.method === 'POST' ? save.promise : response({ maps }));
  const { result } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  let pending!: Promise<ConceptMap>;
  act(() => { pending = result.current.generateMapAsync(input); });
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
  expect(result.current.conceptMaps).toEqual([]);
  expect(result.current.isGenerating).toBe(true);
  expect(localStorage.getItem('studypod:studio:account:owner:maps')).toBeNull();
  expect(state.generate).toHaveBeenCalledWith(input.content, input.title, undefined, expect.any(Function));
  maps = [saved];
  await act(async () => { save.resolve(response({ map: saved })); expect(await pending).toEqual(saved); });
  await waitFor(() => expect(result.current.conceptMaps).toEqual([saved]));
  expect(localStorage.length).toBe(0);
});
it('surfaces save failure and permits retry without inventing a saved map', async () => {
  let fail = true;
  fetcher.mockImplementation(async (_url, options) => options?.method === 'POST' ? fail ? response({ error: 'Storage unavailable' }, 503) : response({ map: saved }) : response({ maps: [] }));
  const { result } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await expect(result.current.generateMapAsync(input)).rejects.toThrow('Storage unavailable'); });
  await waitFor(() => expect(result.current.mutationError).toBe('Storage unavailable'));
  expect(result.current.conceptMaps).toEqual([]);
  fail = false;
  await act(async () => { expect(await result.current.generateMapAsync(input)).toEqual(saved); });
  await waitFor(() => expect(result.current.mutationError).toBeNull());
});
it('rejects generation completed after an account change before sending a save', async () => {
  const generation = deferred<Pick<ConceptMap, 'nodes' | 'edges'>>(); state.generate.mockReturnValue(generation.promise);
  const { result, rerender } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  let outcome!: Promise<string>;
  act(() => { outcome = result.current.generateMapAsync(input).then(() => 'unexpected success', (error: Error) => error.message); });
  await waitFor(() => expect(state.generate).toHaveBeenCalledTimes(1));
  state.user = { id: 'other' }; rerender();
  await act(async () => { generation.resolve(graph); expect(await outcome).toContain('account or notebook changed'); });
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  expect(result.current.conceptMaps).toEqual([]);
});
it('keeps guest maps identity scoped and preserves unscoped legacy data without exposing it to accounts', async () => {
  const legacy = JSON.stringify([saved]); localStorage.setItem('concept_maps', legacy);
  localStorage.setItem('guest_id', 'first'); state.user = null;
  const { result, rerender } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.conceptMaps).toEqual([]);
  await act(async () => { await result.current.generateMapAsync(input); });
  await waitFor(() => expect(result.current.conceptMaps).toHaveLength(1));
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('studypod:studio:guest:first:maps')!)).toHaveLength(1);
  localStorage.setItem('guest_id', 'second'); rerender();
  await waitFor(() => expect(result.current.conceptMaps).toEqual([]));
  state.user = { id: 'owner' }; rerender();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(result.current.conceptMaps).toEqual([]);
  expect(localStorage.getItem('concept_maps')).toBe(legacy);
});
it('loads account maps into a fresh query cache and sends authenticated delete only after finding the stored map', async () => {
  fetcher.mockImplementation(async (_url, options) => options?.method === 'DELETE' ? response({ success: true }) : response({ maps: [saved] }));
  const { result } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.conceptMaps).toEqual([saved]));
  await act(async () => { await result.current.deleteMapAsync(saved.id); });
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/studio/maps/server-map'), expect.objectContaining({ method: 'DELETE', credentials: 'include' }));
  expect(localStorage.length).toBe(0);
});

it('fails closed without a notebook and never invokes generation or a save', async () => {
  const { result } = renderHook(() => useConceptMap(), { wrapper });
  await act(async () => { await expect(result.current.generateMapAsync(input)).rejects.toThrow('current notebook'); });
  expect(state.generate).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it('surfaces loading and deletion failures while retaining the acknowledged map', async () => {
  let loadFails = true;
  fetcher.mockImplementation(async (_url, options) => options?.method === 'DELETE' ? response({ error: 'Delete unavailable' }, 503) : loadFails ? response({ error: 'Load unavailable' }, 503) : response({ maps: [saved] }));
  const { result } = renderHook(() => useConceptMap('book'), { wrapper });
  await waitFor(() => expect(result.current.loadError).toBe('Load unavailable'));
  loadFails = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ['concept-maps', 'account:owner', 'book'] }); });
  await waitFor(() => expect(result.current.conceptMaps).toEqual([saved]));
  await act(async () => { await expect(result.current.deleteMapAsync(saved.id)).rejects.toThrow('Delete unavailable'); });
  await waitFor(() => expect(result.current.mutationError).toBe('Delete unavailable'));
  expect(result.current.conceptMaps).toEqual([saved]);
});
