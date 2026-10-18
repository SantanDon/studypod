import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useYoutubeProcessing } from '@/hooks/useYoutubeProcessing';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(), fetchSources: vi.fn(), createSource: vi.fn(), updateSource: vi.fn(),
  localGet: vi.fn(), localCreate: vi.fn(), localUpdate: vi.fn(), updateNotebook: vi.fn(),
  extract: vi.fn(), process: vi.fn(), generate: vi.fn(), invalidate: vi.fn(),
  auth: { session: { access_token: 'qa-token' } as { access_token: string } | null },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/hooks/useDocumentProcessing', () => ({ useDocumentProcessing: () => ({ processDocumentAsync: mocks.process }) }));
vi.mock('@/hooks/useNotebookGeneration', () => ({ useNotebookGeneration: () => ({ generateNotebookContentAsync: mocks.generate }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { fetchSources: mocks.fetchSources, createSource: mocks.createSource, updateSource: mocks.updateSource } }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: { getSources: mocks.localGet, createSource: mocks.localCreate, updateSource: mocks.localUpdate, updateNotebook: mocks.updateNotebook } }));
vi.mock('@/lib/extraction/youtubeExtractor', () => ({
  extractVideoId: (url: string) => url.includes('dQw4w9WgXcQ') ? 'dQw4w9WgXcQ' : null,
  extractYoutubeTranscript: mocks.extract,
}));
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const source = {
  id: 'owned-source', notebook_id: 'owned-notebook', title: 'Video', type: 'youtube', url,
  processing_status: 'degraded', content: 'Title and metadata only',
  metadata: { videoId: 'dQw4w9WgXcQ', transcriptStatus: 'metadata_only' },
};
const extraction = (transcriptStatus = 'captions') => ({
  title: 'Recovered video', description: 'Description', url,
  content: transcriptStatus === 'metadata_only' ? 'Title and metadata only' : 'The actual caption transcript provides learning evidence.',
  metadata: { videoId: 'dQw4w9WgXcQ', transcriptStatus, transcriptLineCount: 3, transcriptSegments: [] },
});
async function submit() {
  const hook = renderHook(() => useYoutubeProcessing());
  let success: boolean | undefined;
  await act(async () => { success = await hook.result.current.addYoutubeVideoAsSource(url, 'owned-notebook', 'fr'); });
  return { success, hook };
}
describe('YouTube source recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.session = { access_token: 'qa-token' };
    mocks.fetchSources.mockResolvedValue([source]);
    mocks.localGet.mockReturnValue([source]);
    mocks.extract.mockResolvedValue(extraction());
    mocks.updateSource.mockImplementation(async (_notebook, id, updates) => ({ ...source, ...updates, id }));
    mocks.localUpdate.mockImplementation((id, updates) => ({ ...source, ...updates, id }));
    mocks.createSource.mockImplementation(async (_notebook, updates) => ({ ...source, ...updates, id: 'new-source' }));
    mocks.process.mockResolvedValue(undefined);
    mocks.generate.mockResolvedValue(undefined);
  });
  it('recovers a signed-in metadata-only source in its existing notebook without duplication', async () => {
    const { success } = await submit();
    expect(success).toBe(true);
    expect(mocks.fetchSources).toHaveBeenCalledWith('owned-notebook', 'qa-token');
    expect(mocks.extract).toHaveBeenCalledWith(url, 'qa-token', 'fr');
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.updateSource).toHaveBeenNthCalledWith(1, 'owned-notebook', 'owned-source', expect.objectContaining({ content: extraction().content, processing_status: 'processing' }), 'qa-token');
    expect(mocks.updateSource).toHaveBeenLastCalledWith('owned-notebook', 'owned-source', { processing_status: 'completed' }, 'qa-token');
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'owned-source', notebookId: 'owned-notebook' }));
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it('leaves an already usable duplicate untouched', async () => {
    mocks.fetchSources.mockResolvedValue([{ ...source, content: 'Existing transcript', processing_status: 'completed', metadata: { videoId: 'dQw4w9WgXcQ', transcriptStatus: 'captions' } }]);
    expect((await submit()).success).toBe(false);
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.updateSource).not.toHaveBeenCalled();
    expect(mocks.createSource).not.toHaveBeenCalled();
  });
  it('preserves the original source if extraction fails', async () => {
    mocks.fetchSources.mockResolvedValue([{ ...source, processing_status: 'failed' }]);
    mocks.extract.mockRejectedValue(new Error('Caption service unreachable'));
    const { success, hook } = await submit();
    expect(success).toBe(false);
    expect(hook.result.current.isProcessing).toBe(false);
    expect(mocks.updateSource).not.toHaveBeenCalled();
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('keeps a previous source when a retry still has no captions', async () => {
    mocks.extract.mockResolvedValue(extraction('metadata_only'));
    expect((await submit()).success).toBe(false);
    expect(mocks.updateSource).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Transcript still unavailable' }));
  });
  it('saves a new metadata-only video honestly without indexing or notebook AI generation', async () => {
    mocks.fetchSources.mockResolvedValue([]);
    mocks.extract.mockResolvedValue(extraction('metadata_only'));
    expect((await submit()).success).toBe(true);
    expect(mocks.createSource).toHaveBeenCalledWith('owned-notebook', expect.objectContaining({ processing_status: 'degraded', metadata: expect.objectContaining({ transcriptStatus: 'metadata_only' }) }), 'qa-token');
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(localStorage.getItem(`file_${url}`)).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Video saved without a transcript', description: expect.stringContaining('Re-add this URL to retry') }));
  });
  it('recovers the same local source for guest notebooks', async () => {
    mocks.auth.session = null;
    expect((await submit()).success).toBe(true);
    expect(mocks.localUpdate).toHaveBeenCalledWith('owned-source', expect.objectContaining({ content: extraction().content }));
    expect(mocks.localCreate).not.toHaveBeenCalled();
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });
});
