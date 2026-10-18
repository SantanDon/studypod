import { beforeEach, describe, expect, it, vi } from "vitest";

const { readXlsxFile, extractAudio } = vi.hoisted(() => ({ readXlsxFile: vi.fn(), extractAudio: vi.fn() }));
vi.mock('@/lib/extraction/audioExtractor', () => ({ extractAudio }));

vi.mock("read-excel-file/browser", () => ({
  default: readXlsxFile,
}));

import { extractXLSX, extractEPUB, extractContent, getFileCategory } from "@/lib/extraction/documentExtractor";

describe('EPUB session authorization', () => {
  it('sends the guest identity to the protected extraction endpoint', async () => {
    localStorage.setItem('guest_id', 'guest_synthetic123456789');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: 'Aster Lake lesson' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await extractEPUB(new File(['synthetic'], 'lesson.epub'));
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/audiobook/extract'), expect.objectContaining({
        credentials: 'include', headers: { Authorization: 'Bearer guest_synthetic123456789' },
      }));
    } finally { localStorage.removeItem('guest_id'); vi.unstubAllGlobals(); }
  });

  it('uses the cookie session contract for signed-in extraction', async () => {
    localStorage.removeItem('guest_id');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: 'Aster Lake lesson' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await extractEPUB(new File(['synthetic'], 'lesson.epub'));
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/audiobook/extract'), expect.objectContaining({
        credentials: 'include', headers: { Authorization: 'Bearer COOKIE_SESSION' },
      }));
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('audio source ingestion', () => {
  beforeEach(() => { extractAudio.mockReset(); });

  it.each([['lecture.wav', 'audio/wav'], ['lecture.MP3', ''], ['lecture.m4a', 'application/octet-stream'], ['recording', 'audio/ogg']])('transcribes %s instead of reading binary as text', async (name, type) => {
    const file = new File([new Uint8Array([0, 255, 82, 73, 70, 70])], name, { type });
    const readText = vi.fn(() => { throw new Error('Binary text fallback is forbidden'); });
    Object.defineProperty(file, 'text', { value: readText });
    extractAudio.mockResolvedValue({ text: '  Photosynthesis uses light to produce energy.  ', metadata: { model: 'whisper-tiny' } });
    const result = await extractContent(file);
    expect(extractAudio).toHaveBeenCalledWith(file);
    expect(readText).not.toHaveBeenCalled();
    expect(getFileCategory(file)).toBe('audio');
    expect(result.content).toBe('Photosynthesis uses light to produce energy.');
    expect(result.chunks).toEqual([result.content]);
    expect(result.metadata).toMatchObject({ extractionMethod: 'whisper-browser-transcription', wordCount: 6, charCount: result.content.length });
  });

  it('rejects unsupported transcription without returning a saveable error document', async () => {
    extractAudio.mockRejectedValue(new Error('Audio extraction failed: Web Audio unavailable. Upload a text transcript instead.'));
    await expect(extractContent(new File(['binary'], 'lecture.wav'))).rejects.toThrow('Upload a text transcript instead');
  });

  it('rejects an empty transcript instead of accepting audio as a source', async () => {
    extractAudio.mockResolvedValue({ text: '   ', metadata: { model: 'whisper-tiny' } });
    await expect(extractContent(new File(['binary'], 'lecture.wav'))).rejects.toThrow('no speech transcript');
  });
});

describe("extractXLSX", () => {
  beforeEach(() => {
    readXlsxFile.mockReset();
  });

  it("preserves CSV text without invoking the workbook parser", async () => {
    const file = new File(["topic,score\nGrounding,9"], "sources.csv", {
      type: "text/csv",
    });

    const result = await extractXLSX(file);

    expect(result.content).toBe("topic,score\nGrounding,9");
    expect(result.metadata.pageCount).toBe(1);
    expect(readXlsxFile).not.toHaveBeenCalled();
  });

  it("extracts every workbook sheet and escapes CSV cells", async () => {
    readXlsxFile.mockResolvedValue([
      { sheet: "Sources", data: [["Title", "Summary"], ["Paper", 'Useful, "quoted" text']] },
      { sheet: "Scores", data: [["Paper", 9]] },
    ]);
    const file = new File([new Uint8Array([80, 75])], "sources.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await extractXLSX(file);

    expect(result.content).toContain("=== Sources ===");
    expect(result.content).toContain('Paper,"Useful, ""quoted"" text"');
    expect(result.content).toContain("=== Scores ===");
    expect(result.metadata.pageCount).toBe(2);
  });

  it("rejects legacy XLS files with a useful conversion path", async () => {
    const file = new File(["legacy"], "sources.xls", {
      type: "application/vnd.ms-excel",
    });

    await expect(extractXLSX(file)).rejects.toThrow(
      "Convert the file to .xlsx or .csv first",
    );
  });
});
