/**
 * Enhanced PDF Processing Utilities
 *
 * Comprehensive solution to address persistent PDF extraction issues
 * in the insights-lm application.
 */

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

// Vite emits the worker as a versioned asset and supplies its final public URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PDFExtractionOptions {
  maxPages?: number;
  useWorker?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  verbosity?: number;
}

export interface PDFExtractionResult {
  content: string;
  chunks: string[];
  metadata: {
    extractionMethod: string;
    totalPages: number;
    extractedPages: number;
    wordCount: number;
    charCount: number;
    hasText: boolean;
  };
  success: boolean;
  error?: string;
}

function pageText(items: Array<TextItem | TextMarkedContent>): string {
  const lines: string[] = [];
  let words: string[] = [];
  for (const item of items.filter(isTextItem)) {
    if (item.str.trim()) words.push(item.str.trim());
    if (item.hasEOL) {
      lines.push(words.join(" "));
      words = [];
    }
  }
  if (words.length) lines.push(words.join(" "));
  return lines.join("\n");
}

export async function extractPDFWithFallbacks(
  file: File,
  options: PDFExtractionOptions = {}
): Promise<PDFExtractionResult> {
  const { maxPages = 50, verbosity = 0 } = options;
  const methods = ["pdfjs-worker", "pdfjs-no-worker", "pdfjs-alt-params", "pdfjs-page-rendering"];
  let result = createEmptyResult("all-methods-failed", new Error("No text extracted"));
  for (const method of methods) {
    try {
      // PDF.js can transfer ownership of this buffer to the worker.
      const data = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data,
        cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.394/cmaps/",
        cMapPacked: true,
        verbosity,
        ...(method === "pdfjs-alt-params" && { disableRange: true, disableStream: true }),
      });
      try {
        const pdf = await loadingTask.promise;
        const pages: string[] = [];
        for (let number = 1; number <= Math.min(pdf.numPages, maxPages); number++) {
          try {
            const page = await pdf.getPage(number);
            const { items } = await page.getTextContent();
            const text = pageText(items);
            if (text.trim()) pages.push(text);
          } catch (error) {
            console.warn(`Page ${number} extraction failed:`, error);
          }
        }
        const content = pages.join("\n\n");
        result = {
          content,
          chunks: chunkText(content, 1000),
          metadata: {
            extractionMethod: method,
            totalPages: pdf.numPages,
            extractedPages: pages.length,
            wordCount: content.split(/\s+/).filter(Boolean).length,
            charCount: content.length,
            hasText: pages.length > 0,
          },
          success: pages.length > 0,
        };
        if (result.success) return result;
      } finally {
        await loadingTask.destroy();
      }
    } catch (error) {
      console.warn(`PDF extraction failed (${method}):`, error);
      result = createEmptyResult(method, error);
    }
  }
  return result;
}

/**
 * Create empty result for failed extraction
 */
function createEmptyResult(
  method: string,
  error: unknown
): PDFExtractionResult {
  return {
    content: "",
    chunks: [],
    metadata: {
      extractionMethod: method,
      totalPages: 0,
      extractedPages: 0,
      wordCount: 0,
      charCount: 0,
      hasText: false
    },
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

/**
 * Helper function to chunk text
 */
function chunkText(text: string, maxChunkSize: number = 1000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph + "\n\n";
    } else {
      currentChunk += paragraph + "\n\n";
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Enhanced PDF extraction with improved error handling and fallbacks
 */
export async function enhancedPDFExtraction(file: File): Promise<PDFExtractionResult> {
  console.log(`Starting enhanced PDF extraction for: ${file.name}`);

  const result = await extractPDFWithFallbacks(file);

  if (result.success) {
    console.log(
      `Enhanced PDF extraction successful: ${result.metadata.extractedPages}/${result.metadata.totalPages} pages, ${result.metadata.charCount} chars`,
    );
  } else {
    console.warn("Enhanced PDF extraction failed:", result.error);
  }

  return result;
}

export default {
  extractPDFWithFallbacks,
  enhancedPDFExtraction
};

