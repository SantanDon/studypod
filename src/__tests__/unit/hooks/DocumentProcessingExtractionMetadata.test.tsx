import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticated: true, save: vi.fn(), fetchSources: vi.fn(), localRead: vi.fn(), localSave: vi.fn(), index: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mocks.authenticated ? { access_token: 'synthetic-session' } : null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { updateSource: mocks.save, fetchSources: mocks.fetchSources } }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: { getSourceById: mocks.localRead, updateSource: mocks.localSave } }));
vi.mock('@/lib/extraction/documentProcessor', () => ({ processDocument: mocks.index }));
import { useDocumentProcessing } from '@/hooks/useDocumentProcessing';

const provenance = { model: 'onnx-community/whisper-tiny.en', extractionMethod: 'whisper-browser-transcription', language: 'en', duration: 12.5 };
const request = { sourceId: 'source', notebookId: 'notebook', filePath: 'blob:fixture', sourceType: 'audio', content: 'Cedar seedlings receive six hours of light daily.', metadata: provenance };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.authenticated = true;
  mocks.save.mockResolvedValue({}); mocks.localSave.mockReturnValue({});
  mocks.fetchSources.mockResolvedValue([]);
  mocks.localRead.mockReturnValue({ content: 'Foreign guest text', metadata: { model: 'foreign-model' } });
  mocks.index.mockResolvedValue({ chunks: [{ text: request.content, embedding: [1] }], embeddings: [1] });
});
afterEach(cleanup);
function hook() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useDocumentProcessing(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
async function process(input = request) {
  const { result } = hook();
  await act(async () => { await result.current.processDocumentAsync(input); });
}
describe('extraction provenance across source indexing', () => {
  it('retains actual Whisper provenance in account indexing and completion without reading guest sources', async () => {
    await process();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    for (const [, , updates, token] of mocks.save.mock.calls) {
      expect(updates.metadata).toMatchObject(provenance);
      expect(token).toBe('synthetic-session');
    }
    expect(mocks.save.mock.calls[1][2]).toMatchObject({ processing_status: 'completed', metadata: { chunks: [{ text: request.content, embedding: [1] }], processingStage: 'ready' } });
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.localSave).not.toHaveBeenCalled();
    expect(mocks.fetchSources).not.toHaveBeenCalled();
  });
  it('resolves legacy account callers from authorized source text and provenance instead of the guest cache', async () => {
    mocks.fetchSources.mockResolvedValue([{ id: request.sourceId, content: request.content, metadata: JSON.stringify(provenance) }]);
    const { result } = hook();
    await act(async () => { await result.current.processDocumentAsync({ sourceId: request.sourceId, notebookId: request.notebookId, filePath: request.filePath, sourceType: 'website' }); });
    expect(mocks.fetchSources).toHaveBeenCalledWith('notebook', 'synthetic-session');
    expect(mocks.index).toHaveBeenCalledWith('source', request.content, expect.any(Object));
    expect(mocks.save.mock.calls.at(-1)?.[2].metadata).toMatchObject(provenance);
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.localSave).not.toHaveBeenCalled();
  });
  it('rejects an account source absent from the authorized notebook without guest fallback or mutations', async () => {
    mocks.fetchSources.mockResolvedValue([{ id: 'another-source', content: request.content, metadata: provenance }]);
    const { result } = hook();
    await act(async () => { await expect(result.current.processDocumentAsync({ ...request, content: undefined, metadata: undefined })).rejects.toThrow('unavailable in this account notebook'); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.localSave).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it('retains provenance when semantic indexing degrades', async () => {
    mocks.index.mockRejectedValue(new Error('Index unavailable'));
    await process();
    expect(mocks.save.mock.calls.at(-1)?.[2]).toMatchObject({ processing_status: 'degraded', metadata: { ...provenance, processingError: { code: 'SOURCE_INDEXING_FAILED' } } });
  });
  it('retains provenance when large text skips indexing', async () => {
    await process({ ...request, content: 'a'.repeat(250_001) });
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ processing_status: 'degraded', metadata: { ...provenance, indexingSkipped: true } });
  });
  it('retains legacy guest metadata while explicit extraction metadata takes precedence', async () => {
    mocks.authenticated = false;
    mocks.localRead.mockReturnValue({ content: request.content, metadata: JSON.stringify({ custom: 'retained', model: 'old-model' }) });
    await process();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.localSave.mock.calls.at(-1)?.[1].metadata).toMatchObject({ custom: 'retained', ...provenance });
  });
  it('fails closed for an account without notebook scope instead of writing guest storage', async () => {
    const { result } = hook();
    await act(async () => { await expect(result.current.processDocumentAsync({ ...request, notebookId: undefined })).rejects.toThrow('notebook is required'); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.localSave).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });
});
