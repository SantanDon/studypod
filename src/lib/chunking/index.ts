/**
 * Chunking Module
 * Provides text chunking strategies for document processing
 */

export type {
  Chunk,
  ChunkMetadata,
  ChunkingMethod,
  ChunkingOptions,
} from './chunkingStrategy';

export {
  chunkText,
  chunkByFixedSize,
  chunkBySentence,
  chunkByParagraph,
  chunkBySemantic,
  chunkByTimestamp,
  chunksToStrings,
  getChunkStats
} from './chunkingStrategy';

export type {
  DocumentType,
  DocumentChunkerOptions,
  ChunkingResult,
} from './documentChunker';

export {
  chunkDocument,
  chunkDocumentSimple,
  chunkWithMethod,
  rechunkDocument,
  detectDocumentType,
  getRecommendedMethod,
  getRecommendedChunkSize,
  mergeSmallChunks,
  splitLargeChunks
} from './documentChunker';
