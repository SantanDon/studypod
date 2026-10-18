import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { extractPdf } = vi.hoisted(() => ({ extractPdf: vi.fn() }));
vi.mock('@/lib/extraction/pdfExtractor', () => ({ enhancedPDFExtraction: extractPdf }));
import { uploadPdfToServer } from '@/lib/extraction/serverFileUpload';

describe('PDF upload extraction boundary', () => {
  beforeEach(() => {
    extractPdf.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a corrupted PDF instead of returning a saveable error document', async () => {
    extractPdf.mockImplementation(async () => { throw new Error('Invalid PDF structure'); });
    await expect(uploadPdfToServer(new File(['corrupt'], 'lesson.pdf')))
      .rejects.toThrow('Invalid PDF structure');
  });

  it('rejects an image-only PDF when no text was extracted', async () => {
    extractPdf.mockResolvedValue({ success: true, content: '   ', metadata: { totalPages: 1, extractedPages: 0 } });
    await expect(uploadPdfToServer(new File(['image'], 'scan.pdf')))
      .rejects.toThrow('No text extracted');
  });

  it('preserves actual extracted lesson content and page counts', async () => {
    extractPdf.mockResolvedValue({ success: true, content: 'The control station is North Pier.', metadata: { totalPages: 3, extractedPages: 2 } });
    await expect(uploadPdfToServer(new File(['pdf'], 'lesson.pdf')))
      .resolves.toMatchObject({ content: 'The control station is North Pier.', metadata: { pageCount: 3, extractedPages: 2, extractionMethod: 'pdfjs-client-side' } });
  });
});
