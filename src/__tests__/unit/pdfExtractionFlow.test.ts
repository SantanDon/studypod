import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => pdfjs);
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.min.mjs",
}));

const { enhancedPDFExtraction } = await import("@/lib/extraction/pdfExtractor");

describe("enhancedPDFExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns extracted text and metadata for a readable PDF", async () => {
    pdfjs.getDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [{ str: "StudyPod extracts real PDF text" }],
          }),
        }),
      }),
    });

    const file = new File([new Uint8Array([1, 2, 3])], "readable.pdf", {
      type: "application/pdf",
    });
    const result = await enhancedPDFExtraction(file);

    expect(result).toMatchObject({
      success: true,
      content: "StudyPod extracts real PDF text",
      metadata: {
        extractionMethod: "pdfjs-worker",
        totalPages: 1,
        extractedPages: 1,
        hasText: true,
      },
    });
    expect(result.chunks).toEqual(["StudyPod extracts real PDF text"]);
  });

  it("reopens transferred bytes after failure and preserves PDF line breaks for citations", async () => {
    const destroyFailed = vi.fn();
    const destroyRead = vi.fn();
    pdfjs.getDocument
      .mockImplementationOnce(({ data }: { data: ArrayBuffer }) => {
        structuredClone(data, { transfer: [data] });
        return { promise: Promise.reject(new Error("Worker load failed")), destroy: destroyFailed };
      })
      .mockImplementationOnce(({ data }: { data: ArrayBuffer }) => {
        expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
        expect(destroyFailed).toHaveBeenCalledOnce();
        return {
          destroy: destroyRead,
          promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
              getTextContent: async () => ({ items: [
                { str: "Rain" }, { str: "gauge", hasEOL: true },
                { type: "beginMarkedContent" }, { str: "", hasEOL: true },
                { str: "Read the scale.", hasEOL: true },
              ] }),
            }),
          }),
        };
      });

    const file = new File([new Uint8Array([1, 2, 3])], "lines.pdf");
    const result = await enhancedPDFExtraction(file);
    expect(result.content).toBe("Rain gauge\n\nRead the scale.");
    expect(result.chunks).toEqual([result.content]);
    expect(result.metadata.extractionMethod).toBe("pdfjs-no-worker");
    expect(destroyRead).toHaveBeenCalledOnce();
  });

  it("returns a structured failure instead of a false success for an invalid PDF", async () => {
    pdfjs.getDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: {
        then: (_resolve: unknown, reject: (error: Error) => void) =>
          reject(new Error("Invalid PDF structure")),
      },
    });

    const file = new File([new Uint8Array()], "invalid.pdf", {
      type: "application/pdf",
    });
    const result = await enhancedPDFExtraction(file);

    expect(result).toMatchObject({
      success: false,
      content: "",
      chunks: [],
      metadata: {
        totalPages: 0,
        extractedPages: 0,
        hasText: false,
      },
      error: "Invalid PDF structure",
    });
  });
});
