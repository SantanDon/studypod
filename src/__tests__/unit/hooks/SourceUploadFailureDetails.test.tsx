import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(), update: vi.fn(), upload: vi.fn(), process: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/hooks/useSources', () => ({ useSources: () => ({ sources: [{ id: 'existing' }], addSourceAsync: mocks.add, updateSourceAsync: mocks.update }) }));
vi.mock('@/hooks/useFileUpload', () => ({ useFileUpload: () => ({ uploadFile: mocks.upload }) }));
vi.mock('@/hooks/useDocumentProcessing', () => ({ useDocumentProcessing: () => ({ processDocumentAsync: mocks.process }) }));
vi.mock('@/hooks/useNotebookGeneration', () => ({ useNotebookGeneration: () => ({ generateNotebookContentAsync: vi.fn() }) }));
vi.mock('@/hooks/useNotebookUpdate', () => ({ useNotebookUpdate: () => ({ updateNotebook: vi.fn() }) }));
vi.mock('@/hooks/useWebsiteProcessing', () => ({ useWebsiteProcessing: () => ({ addWebsitesAsSources: vi.fn(), isProcessing: false }) }));
vi.mock('@/hooks/useYoutubeProcessing', () => ({ useYoutubeProcessing: () => ({ addYoutubeVideoAsSource: vi.fn(), isProcessing: false }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ isGuest: false }), useNotebookLimits: () => ({ canAddSource: true, sourcesRemaining: 20 }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
import { useAddSourcesHandlers } from '@/components/notebook/hooks/useAddSourcesHandlers';

const originalMetadata = { fileName: 'lecture.txt', fileType: 'text/plain', custom: { retained: true } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.add.mockResolvedValue({ id: 'source', metadata: JSON.stringify(originalMetadata) });
  mocks.update.mockResolvedValue({ id: 'source', metadata: originalMetadata });
  mocks.process.mockResolvedValue({ success: true });
});
afterEach(cleanup);

async function upload() {
  const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
  await act(async () => { await result.current.handleFileUpload([new File(['lesson'], 'lecture.txt', { type: 'text/plain' })]); });
  await waitFor(() => expect(mocks.update.mock.calls.some(([call]) => call.updates.processing_status === 'failed')).toBe(true));
  return mocks.update.mock.calls.findLast(([call]) => call.updates.processing_status === 'failed')![0].updates;
}

describe('durable source upload failure details', () => {
  it('passes saved extraction provenance and original file metadata into indexing', async () => {
    const extraction = { model: 'onnx-community/whisper-tiny.en', extractionMethod: 'whisper-browser-transcription', duration: 12.5 };
    mocks.upload.mockResolvedValue({ success: true, filePath: 'blob:lecture', content: 'lesson', metadata: extraction });
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload([new File(['lesson'], 'lecture.txt', { type: 'text/plain' })]); });
    await waitFor(() => expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'notebook', sourceId: 'source', metadata: { ...originalMetadata, ...extraction } })));
    expect(mocks.update).toHaveBeenCalledWith({ sourceId: 'source', updates: { file_path: 'blob:lecture', processing_status: 'processing', content: 'lesson', metadata: { ...originalMetadata, ...extraction } } });
  });
  it('retains a rejected extraction reason and original file metadata after the toast', async () => {
    mocks.upload.mockRejectedValue(new Error('Audio decoder cannot read this file. Export a WAV and retry.'));
    const updates = await upload();
    expect(updates.metadata).toMatchObject({ ...originalMetadata, processingStage: 'extracting', processingError: {
      code: 'SOURCE_EXTRACTION_FAILED', stage: 'extracting', retryable: true,
      message: 'Audio decoder cannot read this file. Export a WAV and retry.',
    } });
    expect(updates.metadata.processingError.occurredAt).toEqual(expect.any(String));
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('also persists a returned upload failure, without treating it as success', async () => {
    mocks.upload.mockResolvedValue({ success: false, error: 'Transcript model unavailable. Check model configuration.' });
    expect((await upload()).metadata.processingError.message).toContain('Transcript model unavailable. Check model configuration.');
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('does not overwrite richer metadata already persisted by document processing', async () => {
    mocks.upload.mockResolvedValue({ success: true, filePath: 'lecture.txt', content: 'lesson', metadata: {} });
    mocks.process.mockRejectedValue(new Error('Specific processing failure'));
    expect(await upload()).toEqual({ processing_status: 'failed' });
  });
  it('preserves an existing richer error in the latest source metadata', async () => {
    const processingError = { code: 'SOURCE_INDEXING_FAILED', message: 'Index unavailable', stage: 'indexing', retryable: false, occurredAt: '2026-10-12T00:00:00Z' };
    mocks.update.mockResolvedValue({ metadata: JSON.stringify({ ...originalMetadata, processingError }) });
    mocks.upload.mockRejectedValue(new Error('Wrapper failure'));
    const updates = await upload();
    expect(updates.metadata.processingError).toEqual(processingError);
    expect(updates.metadata.processingStage).toBe('indexing');
    expect(updates.metadata.custom).toEqual({ retained: true });
  });
});
