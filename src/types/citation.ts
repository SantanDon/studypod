export interface CitationMatch {
  citationId: number | string;
  sourceId: string;
  chunkIndex: number;
  matchedText: string;
  confidence: number;
  startOffset: number;
  endOffset: number;
}

export interface ParsedCitation {
  marker: string;
  index: number;
  position: number;
  length: number;
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  content: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, unknown>;
}

export interface HighlightedExcerpt {
  citationId: number | string;
  fullText: string;
  highlightStart: number;
  highlightEnd: number;
  contextBefore: string;
  matchedText: string;
  contextAfter: string;
}

export interface CitationContext {
  citation: CitationMatch;
  sourceTitle: string;
  sourceType: string;
  excerpt: HighlightedExcerpt;
}
