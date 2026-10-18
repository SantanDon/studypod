import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-a' }, session: { access_token: 'synthetic-session' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/apiService', () => ({ API_BASE_URL: '/api', ApiService: { updateSource: mocks.save } }));
vi.mock('@/services/localStorageService', () => ({ localStorageService: { getSourceById: vi.fn() } }));
vi.mock('@/lib/extraction/documentExtractor', () => ({ extractContent: mocks.extract, getFileCategory: () => 'document' }));
vi.mock('@/lib/extraction/contentValidator', () => ({ validateDocumentContent: async () => ({ isValid: true, isHighQuality: true, issues: [] }) }));
vi.mock('@/lib/ai/ollamaService', () => ({ isReadableText: () => true }));
import { useFileUpload } from '@/hooks/useFileUpload';

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:synthetic-upload' });
  mocks.extract.mockResolvedValue({ content: 'Cedar has seventeen blue trays.', chunks: ['Cedar has seventeen blue trays.'], metadata: { extractionMethod: 'text' } });
  mocks.save.mockRejectedValue(new Error('connection unavailable'));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function upload() {
  const { result } = renderHook(() => useFileUpload());
  let outcome: Awaited<ReturnType<typeof result.current.uploadFile>>;
  await act(async () => { outcome = await result.current.uploadFile(new File(['synthetic'], 'cedar.txt', { type: 'text/plain' }), 'notebook', 'source'); });
  return outcome!;
}
describe('file upload persistence classification', () => {
  it('returns the same complete metadata that was acknowledged by the account save', async () => {
    mocks.save.mockResolvedValue({});
    const outcome = await upload();
    expect(outcome.success).toBe(true);
    if (!outcome.success) throw new Error('Upload failed');
    expect(outcome.metadata).toEqual(mocks.save.mock.calls[0][2].metadata);
    expect(outcome.metadata).toMatchObject({ extractionMethod: 'text', fileCategory: 'document', validation: { isValid: true }, chunks: ['Cedar has seventeen blue trays.'] });
  });
  it('classifies an extracted-content save failure without caching authenticated source text', async () => {
    expect(await upload()).toMatchObject({ success: false, failureCode: 'SOURCE_SAVE_FAILED', failureStage: 'saving' });
    expect(mocks.save).toHaveBeenCalledWith('notebook', 'source', expect.objectContaining({ content: 'Cedar has seventeen blue trays.' }), 'synthetic-session');
    expect(localStorage.length).toBe(0);
  });
  it('keeps extraction rejection distinct and never calls the source save', async () => {
    mocks.extract.mockRejectedValue(new Error('Corrupt DOCX archive'));
    const outcome = await upload();
    expect(outcome).toMatchObject({ success: false, error: 'Corrupt DOCX archive' });
    expect(outcome).not.toHaveProperty('failureCode');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
