import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), upload: vi.fn(), process: vi.fn(), toast: vi.fn(), guest: false, notebookOwner: 'guest-a', increment: vi.fn() }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: { getNotebook: (id: string) => ({ id, user_id: mocks.notebookOwner }) } }));
vi.mock('@/hooks/useSources', () => ({ useSources: () => ({ sources: [{ id: 'existing' }], addSourceAsync: mocks.add, updateSourceAsync: mocks.update }) }));
vi.mock('@/hooks/useFileUpload', () => ({ useFileUpload: () => ({ uploadFile: mocks.upload, ownerId: 'owner-a' }) }));
vi.mock('@/hooks/useDocumentProcessing', () => ({ useDocumentProcessing: () => ({ processDocumentAsync: mocks.process }) }));
vi.mock('@/hooks/useNotebookGeneration', () => ({ useNotebookGeneration: () => ({ generateNotebookContentAsync: vi.fn() }) }));
vi.mock('@/hooks/useNotebookUpdate', () => ({ useNotebookUpdate: () => ({ updateNotebook: vi.fn() }) }));
vi.mock('@/hooks/useWebsiteProcessing', () => ({ useWebsiteProcessing: () => ({ addWebsitesAsSources: vi.fn(), isProcessing: false }) }));
vi.mock('@/hooks/useYoutubeProcessing', () => ({ useYoutubeProcessing: () => ({ addYoutubeVideoAsSource: vi.fn(), isProcessing: false }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ isGuest: mocks.guest, guestId: 'guest-a', incrementUsage: mocks.increment }), useNotebookLimits: () => ({ canAddSource: true, sourcesRemaining: 20 }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
import { useAddSourcesHandlers } from '@/components/notebook/hooks/useAddSourcesHandlers';
import { clearUploadInterruption, hasActiveSourceUploads, readRecoverableUploadInterruptions, readUploadInterruptions, recordUploadInterruption } from '@/lib/sources/sourceUploadInterruption';
const scope = { ownerId: 'owner-a', notebookId: 'notebook' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.guest = false; mocks.notebookOwner = 'guest-a';
  mocks.process.mockReset();
  mocks.add.mockResolvedValue({ id: 'source', metadata: { fileName: 'lecture.txt' } });
  mocks.update.mockResolvedValue({ id: 'source', metadata: { fileName: 'lecture.txt' } });
  mocks.upload.mockResolvedValue({ success: false, error: 'Save unavailable', failureCode: 'SOURCE_SAVE_FAILED', failureStage: 'saving' });
});
afterEach(cleanup);
async function upload() {
  const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
  await act(async () => { await result.current.handleFileUpload([new File(['synthetic'], 'lecture.txt', { type: 'text/plain' })]); });
  await waitFor(() => expect(mocks.update.mock.calls.some(([call]) => call.updates.processing_status === 'failed')).toBe(true));
}
describe('authenticated source save interruption', () => {
  it.each(['completed', 'degraded'] as const)('releases %s acknowledged uploads after the notebook UI unmounts', async status => {
    mocks.upload.mockResolvedValue({ success: true, content: 'Synthetic Cedar facts', filePath: 'synthetic.txt' });
    let acknowledge!: (value: unknown) => void;
    mocks.process.mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
    const { result, unmount } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload([new File(['synthetic'], 'lecture.txt', { type: 'text/plain' })]); });
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(1));
    unmount();
    expect(readUploadInterruptions(scope)).toHaveLength(1);
    expect(hasActiveSourceUploads()).toBe(true);
    expect(readRecoverableUploadInterruptions(scope)).toEqual([]);
    await act(async () => { acknowledge({ sourceId: 'source', status, success: status === 'completed' }); });
    await waitFor(() => expect(readUploadInterruptions(scope)).toEqual([]));
    expect(hasActiveSourceUploads()).toBe(false);
    expect(mocks.update.mock.calls.some(([call]) => call.updates.processing_status === 'failed')).toBe(false);
  });
  it('does not release a receipt for a different source terminal acknowledgement', async () => {
    mocks.upload.mockResolvedValue({ success: true, content: 'Synthetic Cedar facts', filePath: 'synthetic.txt' });
    mocks.process.mockResolvedValue({ sourceId: 'another-source', status: 'completed', success: true });
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload([new File(['synthetic'], 'lecture.txt', { type: 'text/plain' })]); });
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(1));
    expect(readUploadInterruptions(scope)).toHaveLength(1);
    expect(hasActiveSourceUploads()).toBe(true);
    clearUploadInterruption(scope, 'source');
  });
  it('retains recovery metadata when terminal persistence and the failed-marker save both reject after unmount', async () => {
    mocks.upload.mockResolvedValue({ success: true, content: 'Synthetic Cedar facts', filePath: 'synthetic.txt' });
    mocks.update.mockImplementation(({ updates }) => updates.processing_status === 'failed' ? Promise.reject(new Error('Synthetic failed-marker write unavailable')) : Promise.resolve({ id: 'source' }));
    let rejectAcknowledgement!: (reason: Error) => void;
    mocks.process.mockReturnValue(new Promise((_resolve, reject) => { rejectAcknowledgement = reject; }));
    const { result, unmount } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload([new File(['synthetic'], 'lecture.txt', { type: 'text/plain' })]); });
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(1));
    unmount();
    expect(hasActiveSourceUploads()).toBe(true);
    await act(async () => { rejectAcknowledgement(new Error('Synthetic terminal write unavailable')); });
    await waitFor(() => expect(readRecoverableUploadInterruptions(scope)).toHaveLength(1));
    expect(readUploadInterruptions(scope)[0]).toMatchObject({ sourceId: 'source', fileName: 'lecture.txt', stage: 'processing' });
    expect(readUploadInterruptions({ ...scope, ownerId: 'owner-b' })).toEqual([]);
    expect(hasActiveSourceUploads()).toBe(false);
    clearUploadInterruption(scope, 'source');
  });
  it('protects the guest queue using verified notebook ownership and clears acknowledged failure', async () => {
    mocks.guest = true;
    const guestScope = { kind: 'guest' as const, ownerId: 'guest-a', notebookId: 'notebook' };
    let nextSource = 0;
    mocks.add.mockImplementation(async () => ({ id: `guest-queued-${++nextSource}` }));
    let releaseUploads!: (value: unknown) => void;
    mocks.upload.mockReturnValue(new Promise(resolve => { releaseUploads = resolve; }));
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload(Array.from({ length: 5 }, (_, index) =>
      new File(['synthetic'], `guest-${index}.txt`, { type: 'text/plain' }))); });
    expect(readUploadInterruptions(guestScope)).toHaveLength(5);
    expect(readUploadInterruptions(scope)).toEqual([]);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    expect(mocks.increment).toHaveBeenCalledTimes(5);
    expect(readRecoverableUploadInterruptions(guestScope)).toEqual([]);
    releaseUploads({ success: false, error: 'Synthetic extraction rejection' });
    await waitFor(() => expect(mocks.update.mock.calls.filter(([call]) => call.updates.processing_status === 'failed')).toHaveLength(5));
    await waitFor(() => expect(readUploadInterruptions(guestScope)).toEqual([]));
  });
  it('does not create guest receipts for a notebook owned by another guest', async () => {
    mocks.guest = true; mocks.notebookOwner = 'guest-b';
    await upload();
    expect(readUploadInterruptions({ kind: 'guest', ownerId: 'guest-a', notebookId: 'notebook' })).toEqual([]);
  });
  it('identifies the failed creation filename while the independently valid file continues', async () => {
    mocks.add.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'valid-source' });
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    await act(async () => { await result.current.handleFileUpload([
      new File(['synthetic'], 'failed-create.txt', { type: 'text/plain' }),
      new File(['synthetic'], 'valid-create.txt', { type: 'text/plain' }),
    ]); });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload.mock.calls[0][0].name).toBe('valid-create.txt');
    expect(mocks.toast.mock.calls.find(([call]) => call.title === 'Some files queued')![0].description).toContain('failed-create.txt');
    expect(readUploadInterruptions(scope).some(entry => entry.fileName === 'failed-create.txt')).toBe(false);
    await waitFor(() => expect(readUploadInterruptions(scope)).toEqual([]));
  });
  it('lists every rejected filename instead of silently omitting the fourth rejection', async () => {
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    const files = Array.from({ length: 4 }, (_, index) => new File(['synthetic'], `unsupported-${index}.exe`));
    await act(async () => { await result.current.handleFileUpload(files); });
    const description = mocks.toast.mock.calls.find(([call]) => call.title === 'Files not added')![0].description;
    files.forEach(file => expect(description).toContain(file.name));
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('protects every acknowledged queued source before extraction starts, without alerting live uploads', async () => {
    let nextSource = 0;
    mocks.add.mockImplementation(async () => ({ id: `queued-${++nextSource}` }));
    let releaseUploads!: (value: unknown) => void;
    const blockedUpload = new Promise(resolve => { releaseUploads = resolve; });
    mocks.upload.mockReturnValue(blockedUpload);
    const { result } = renderHook(() => useAddSourcesHandlers('notebook', vi.fn(), false));
    const files = Array.from({ length: 4 }, (_, index) => new File(['synthetic'], `queued-${index}.txt`, { type: 'text/plain' }));
    await act(async () => { await result.current.handleFileUpload(files); });
    expect(readUploadInterruptions(scope)).toHaveLength(4);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    expect(readUploadInterruptions(scope).some(entry => entry.sourceId === 'queued-4')).toBe(true);
    expect(readRecoverableUploadInterruptions(scope)).toEqual([]);
    releaseUploads({ success: false, error: 'Synthetic extraction rejection' });
    await waitFor(() => expect(mocks.update.mock.calls.filter(([call]) => call.updates.processing_status === 'failed')).toHaveLength(4));
    await waitFor(() => expect(readUploadInterruptions(scope)).toEqual([]));
    for (let index = 1; index <= 4; index++) clearUploadInterruption(scope, `queued-${index}`);
  });
  it('persists SOURCE_SAVE_FAILED before clearing the local interruption after a successful failed-marker acknowledgement', async () => {
    recordUploadInterruption(scope, { sourceId: 'source', fileName: 'lecture.txt', stage: 'saving' });
    await upload();
    const failed = mocks.update.mock.calls.findLast(([call]) => call.updates.processing_status === 'failed')![0];
    expect(failed.updates.metadata.processingError).toMatchObject({ code: 'SOURCE_SAVE_FAILED', stage: 'saving', message: 'Upload Error: Save unavailable' });
    expect(readUploadInterruptions(scope)).toEqual([]);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('retains a scoped receipt when the failed-marker save is also unavailable', async () => {
    mocks.update.mockImplementation(({ updates }) => updates.processing_status === 'failed' ? Promise.reject(new Error('offline')) : Promise.resolve({ id: 'source' }));
    await upload();
    await waitFor(() => expect(readUploadInterruptions(scope)).toHaveLength(1));
    expect(readUploadInterruptions(scope)[0]).toMatchObject({ sourceId: 'source', fileName: 'lecture.txt', stage: 'saving' });
    expect(readUploadInterruptions({ ...scope, ownerId: 'owner-b' })).toEqual([]);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
