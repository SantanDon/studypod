/**
 * Document Chunker
 * Auto-detects best chunking strategy based on document type
 */

import type { Chunk, ChunkingMethod, ChunkingOptions } from './chunkingStrategy';
import {
  chunkText,
  chunkByParagraph,
  chunkBySemantic,
  chunkBySentence,
  chunkByTimestamp,
  chunkByFixedSize,
  getChunkStats,
  chunksToStrings
} from './chunkingStrategy';

export type DocumentType = 'pdf' | 'web' | 'youtube' | 'text' | 'note' | 'docx' | 'spreadsheet' | 'html' | 'unknown';

export interface DocumentChunkerOptions extends ChunkingOptions {
  documentType?: DocumentType;
  autoDetect?: boolean;
}

export interface ChunkingResult {
  chunks: Chunk[];
  method: ChunkingMethod;
  documentType: DocumentType;
  stats: {
    count: number;
    totalLength: number;
    avgLength: number;
    minLength: number;
    maxLength: number;
  };
}

/**
 * Detect document type from content and metadata
 */
export function detectDocumentType(
  content: string,
  metadata?: { sourceType?: string; fileName?: string; url?: string }
): DocumentType {
  // Check metadata first
  if (metadata?.sourceType) {
    const sourceType = metadata.sourceType.toLowerCase();
    if (sourceType.includes('pdf')) return 'pdf';
    if (sourceType.includes('youtube') || sourceType.includes('video')) return 'youtube';
    if (sourceType.includes('web') || sourceType.includes('url')) return 'web';
    if (sourceType.includes('note')) return 'note';
    if (sourceType.includes('docx') || sourceType.includes('word')) return 'docx';
    if (sourceType.includes('spreadsheet') || sourceType.includes('excel') || sourceType.includes('csv')) return 'spreadsheet';
    if (sourceType.includes('html')) return 'html';
  }

  // Check file extension
  if (metadata?.fileName) {
    const ext = metadata.fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf': return 'pdf';
      case 'docx': case 'doc': return 'docx';
      case 'xlsx': case 'xls': case 'csv': return 'spreadsheet';
      case 'html': case 'htm': return 'html';
      case 'md': case 'txt': return 'text';
    }
  }

  // Check URL patterns
  if (metadata?.url) {
    const url = metadata.url.toLowerCase();
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.startsWith('http')) return 'web';
  }

  // Content-based detection
  return detectTypeFromContent(content);
}

/**
 * Detect document type from content patterns
 */
function detectTypeFromContent(content: string): DocumentType {
  if (!content || content.length === 0) return 'unknown';

  // Check for timestamp patterns (YouTube/podcast transcripts)
  const timestampPatterns = [
    /\[\d{1,2}:\d{2}(?::\d{2})?\]/,
    /\(\d{1,2}:\d{2}(?::\d{2})?\)/,
    /^\d{1,2}:\d{2}(?::\d{2})?\s/m,
  ];
  
  for (const pattern of timestampPatterns) {
    if (pattern.test(content)) {
      return 'youtube';
    }
  }

  // Check for HTML content
  if (/<html|<head|<body|<div|<p\s|<span/i.test(content)) {
    return 'html';
  }

  // Check for web content patterns
  const webPatterns = [
    /^https?:\/\//m,
    /Cookie Policy|Privacy Policy|Terms of Service/i,
    /Subscribe|Newsletter|Follow us/i,
    /<script|<style|<link/i,
  ];

  let webScore = 0;
  for (const pattern of webPatterns) {
    if (pattern.test(content)) webScore++;
  }
  if (webScore >= 2) return 'web';

  // Check for PDF-like patterns (page numbers, footers)
  const pdfPatterns = [
    /Page \d+ of \d+/i,
    /^\d+\s*$/m, // Standalone page numbers
    /Copyright ©/i,
    /All rights reserved/i,
  ];

  let pdfScore = 0;
  for (const pattern of pdfPatterns) {
    if (pattern.test(content)) pdfScore++;
  }
  if (pdfScore >= 2) return 'pdf';

  // Check for spreadsheet-like content (CSV, tabular)
  const lines = content.split('\n').slice(0, 10);
  const commaDelimited = lines.filter(line => (line.match(/,/g) || []).length >= 3);
  const tabDelimited = lines.filter(line => (line.match(/\t/g) || []).length >= 2);
  
  if (commaDelimited.length >= 3 || tabDelimited.length >= 3) {
    return 'spreadsheet';
  }

  // Check for markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,
    /^\*\s+|\d+\.\s+/m,
    /\[.+\]\(.+\)/,
    /```[\s\S]*```/,
  ];

  let mdScore = 0;
  for (const pattern of markdownPatterns) {
    if (pattern.test(content)) mdScore++;
  }
  if (mdScore >= 2) return 'text';

  // Default to text
  return 'text';
}

/**
 * Get recommended chunking method for document type
 */
export function getRecommendedMethod(documentType: DocumentType): ChunkingMethod {
  switch (documentType) {
    case 'pdf':
      return 'semantic'; // PDFs often have clear sections and structure
    case 'web':
      return 'semantic'; // Web content usually has sections/headings
    case 'youtube':
      return 'timestamp'; // Transcripts have timestamps
    case 'docx':
      return 'paragraph'; // Word docs have paragraphs
    case 'html':
      return 'semantic'; // HTML has structure
    case 'spreadsheet':
      return 'fixed'; // Tabular data needs fixed chunking
    case 'note':
      return 'sentence'; // Notes are often shorter, sentence works well
    case 'text':
    default:
      return 'sentence'; // Default to sentence for general text
  }
}

/**
 * Get recommended chunk size for document type
 */
export function getRecommendedChunkSize(documentType: DocumentType): number {
  switch (documentType) {
    case 'pdf':
      return 1000; // Larger chunks for structured documents
    case 'web':
      return 800; // Medium chunks for web content
    case 'youtube':
      return 600; // Smaller chunks for transcripts (easier to reference)
    case 'docx':
      return 1000;
    case 'spreadsheet':
      return 500; // Smaller for tabular data
    case 'note':
      return 500; // Smaller for notes
    case 'text':
    default:
      return 800;
  }
}

/**
 * Main document chunking function
 * Auto-detects document type and applies appropriate chunking strategy
 */
export function chunkDocument(
  content: string,
  options: DocumentChunkerOptions = {}
): ChunkingResult {
  const {
    documentType: providedType,
    autoDetect = true,
    method: providedMethod,
    chunkSize: providedChunkSize,
    overlap = 100,
    sourceId
  } = options;

  // Determine document type
  let documentType: DocumentType;
  if (providedType) {
    documentType = providedType;
  } else if (autoDetect) {
    documentType = detectDocumentType(content);
  } else {
    documentType = 'text';
  }

  // Determine chunking method
  const method = providedMethod || getRecommendedMethod(documentType);

  // Determine chunk size
  const chunkSize = providedChunkSize || getRecommendedChunkSize(documentType);

  // Apply chunking
  const chunks = chunkText(content, {
    method,
    chunkSize,
    overlap,
    sourceId
  });

  // Get statistics
  const stats = getChunkStats(chunks);

  console.log(
    `📦 Document chunked: ${documentType} → ${method} method, ` +
    `${stats.count} chunks (avg ${stats.avgLength} chars)`
  );

  return {
    chunks,
    method,
    documentType,
    stats
  };
}

/**
 * Chunk document and return simple string array (backward compatible)
 */
export function chunkDocumentSimple(
  content: string,
  options: DocumentChunkerOptions = {}
): string[] {
  const result = chunkDocument(content, options);
  return chunksToStrings(result.chunks);
}

/**
 * Chunk with explicit method selection
 */
export function chunkWithMethod(
  content: string,
  method: ChunkingMethod,
  options: Omit<ChunkingOptions, 'method'> = {}
): Chunk[] {
  switch (method) {
    case 'fixed':
      return chunkByFixedSize(content, options);
    case 'sentence':
      return chunkBySentence(content, options);
    case 'paragraph':
      return chunkByParagraph(content, options);
    case 'semantic':
      return chunkBySemantic(content, options);
    case 'timestamp':
      return chunkByTimestamp(content, options);
    default:
      return chunkByParagraph(content, options);
  }
}

/**
 * Re-chunk existing chunks with a different strategy
 */
export function rechunkDocument(
  chunks: Chunk[],
  newMethod: ChunkingMethod,
  options: Omit<ChunkingOptions, 'method'> = {}
): Chunk[] {
  // Combine all chunks back into full text
  const fullText = chunks.map(c => c.text).join('\n\n');
  
  // Re-chunk with new method
  return chunkWithMethod(fullText, newMethod, options);
}

/**
 * Merge small chunks that are below threshold
 */
export function mergeSmallChunks(
  chunks: Chunk[],
  minSize: number = 100
): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: Chunk[] = [];
  let current: Chunk | null = null;

  for (const chunk of chunks) {
    if (!current) {
      current = { ...chunk };
      continue;
    }

    if (current.text.length < minSize) {
      // Merge with next chunk
      current.text = current.text + '\n\n' + chunk.text;
      current.metadata.end = chunk.metadata.end;
    } else {
      merged.push(current);
      current = { ...chunk };
    }
  }

  if (current) {
    merged.push(current);
  }

  // Re-index
  return merged.map((chunk, index) => ({
    ...chunk,
    index,
    metadata: { ...chunk.metadata, index }
  }));
}

/**
 * Split chunks that are above threshold
 */
export function splitLargeChunks(
  chunks: Chunk[],
  maxSize: number = 1500
): Chunk[] {
  const result: Chunk[] = [];
  let newIndex = 0;

  for (const chunk of chunks) {
    if (chunk.text.length <= maxSize) {
      result.push({
        ...chunk,
        index: newIndex,
        metadata: { ...chunk.metadata, index: newIndex }
      });
      newIndex++;
    } else {
      // Split large chunk
      const subChunks = chunkBySentence(chunk.text, {
        chunkSize: maxSize,
        sourceId: chunk.metadata.sourceId
      });

      for (const subChunk of subChunks) {
        result.push({
          ...subChunk,
          index: newIndex,
          metadata: {
            ...subChunk.metadata,
            index: newIndex,
            start: chunk.metadata.start + subChunk.metadata.start,
            end: chunk.metadata.start + subChunk.metadata.end
          }
        });
        newIndex++;
      }
    }
  }

  return result;
}

// Re-export for convenience
export type { Chunk, ChunkingMethod, ChunkingOptions } from './chunkingStrategy';
export { getChunkStats, chunksToStrings } from './chunkingStrategy';
