import { Citation } from '@/types/message';
import {
  CitationMatch,
  ParsedCitation,
  SourceChunk,
  HighlightedExcerpt,
} from '@/types/citation';

const CITATION_PATTERN = /\[(\d+)\]/g;
const CONTEXT_CHARS = 100;

export function extractCitations(text: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  let match: RegExpExecArray | null;

  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    citations.push({
      marker: match[0],
      index: parseInt(match[1], 10),
      position: match.index,
      length: match[0].length,
    });
  }

  return citations;
}

export function mapCitationsToSources(
  parsedCitations: ParsedCitation[],
  citations: Citation[]
): Map<number, Citation> {
  const citationMap = new Map<number, Citation>();

  for (const parsed of parsedCitations) {
    const matching = citations.find(
      (c) =>
        c.citation_id === parsed.index ||
        c.chunk_index === parsed.index - 1
    );
    if (matching) {
      citationMap.set(parsed.index, matching);
    }
  }

  return citationMap;
}

export function generateHighlightedExcerpt(
  citation: Citation,
  sourceContent: string,
  searchText?: string
): HighlightedExcerpt {
  const citationId = citation.citation_id;
  const lines = sourceContent.split('\n');

  let startLine = citation.chunk_lines_from ?? 1;
  let endLine = citation.chunk_lines_to ?? lines.length;

  startLine = Math.max(1, startLine);
  endLine = Math.min(lines.length, endLine);

  const chunkLines = lines.slice(startLine - 1, endLine);
  const fullText = chunkLines.join('\n');

  let highlightStart = 0;
  let highlightEnd = fullText.length;
  let matchedText = fullText;
  let contextBefore = '';
  let contextAfter = '';

  if (searchText && searchText.trim()) {
    const normalizedSearch = searchText.toLowerCase().trim();
    const normalizedContent = fullText.toLowerCase();
    const matchIndex = normalizedContent.indexOf(normalizedSearch);

    if (matchIndex !== -1) {
      highlightStart = matchIndex;
      highlightEnd = matchIndex + searchText.length;
      matchedText = fullText.substring(highlightStart, highlightEnd);

      const beforeStart = Math.max(0, highlightStart - CONTEXT_CHARS);
      contextBefore = fullText.substring(beforeStart, highlightStart);
      if (beforeStart > 0) {
        contextBefore = '...' + contextBefore;
      }

      const afterEnd = Math.min(fullText.length, highlightEnd + CONTEXT_CHARS);
      contextAfter = fullText.substring(highlightEnd, afterEnd);
      if (afterEnd < fullText.length) {
        contextAfter = contextAfter + '...';
      }
    }
  } else if (citation.excerpt) {
    const excerptIndex = fullText.indexOf(citation.excerpt);
    if (excerptIndex !== -1) {
      highlightStart = excerptIndex;
      highlightEnd = excerptIndex + citation.excerpt.length;
      matchedText = citation.excerpt;

      const beforeStart = Math.max(0, highlightStart - CONTEXT_CHARS);
      contextBefore = fullText.substring(beforeStart, highlightStart);
      if (beforeStart > 0) {
        contextBefore = '...' + contextBefore;
      }

      const afterEnd = Math.min(fullText.length, highlightEnd + CONTEXT_CHARS);
      contextAfter = fullText.substring(highlightEnd, afterEnd);
      if (afterEnd < fullText.length) {
        contextAfter = contextAfter + '...';
      }
    }
  }

  return {
    citationId,
    fullText,
    highlightStart,
    highlightEnd,
    contextBefore,
    matchedText,
    contextAfter,
  };
}

export function calculateCitationConfidence(
  citedText: string,
  sourceText: string
): number {
  if (!citedText || !sourceText) {
    return 0;
  }

  const normalizedCited = normalizeText(citedText);
  const normalizedSource = normalizeText(sourceText);

  if (normalizedSource.includes(normalizedCited)) {
    return 1.0;
  }

  const citedWords = new Set(normalizedCited.split(/\s+/).filter(Boolean));
  const sourceWords = new Set(normalizedSource.split(/\s+/).filter(Boolean));

  if (citedWords.size === 0) {
    return 0;
  }

  let matchingWords = 0;
  for (const word of citedWords) {
    if (sourceWords.has(word)) {
      matchingWords++;
    }
  }

  const wordOverlap = matchingWords / citedWords.size;

  const citedBigrams = generateNgrams(normalizedCited, 2);
  const sourceBigrams = generateNgrams(normalizedSource, 2);

  let matchingBigrams = 0;
  for (const bigram of citedBigrams) {
    if (sourceBigrams.has(bigram)) {
      matchingBigrams++;
    }
  }

  const bigramOverlap =
    citedBigrams.size > 0 ? matchingBigrams / citedBigrams.size : 0;

  const confidence = wordOverlap * 0.4 + bigramOverlap * 0.6;

  return Math.round(confidence * 100) / 100;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateNgrams(text: string, n: number): Set<string> {
  const words = text.split(/\s+/).filter(Boolean);
  const ngrams = new Set<string>();

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }

  return ngrams;
}

export function createCitationMatch(
  citation: Citation,
  sourceContent: string,
  responseText?: string
): CitationMatch {
  const excerpt = generateHighlightedExcerpt(citation, sourceContent);
  const confidence = responseText
    ? calculateCitationConfidence(responseText, excerpt.matchedText)
    : 1.0;

  return {
    citationId: citation.citation_id,
    sourceId: citation.source_id,
    chunkIndex: citation.chunk_index ?? 0,
    matchedText: excerpt.matchedText,
    confidence,
    startOffset: excerpt.highlightStart,
    endOffset: excerpt.highlightEnd,
  };
}

export function findBestMatchInSource(
  searchText: string,
  sourceContent: string,
  chunks?: SourceChunk[]
): { chunkIndex: number; startOffset: number; endOffset: number } | null {
  const normalizedSearch = normalizeText(searchText);

  if (chunks && chunks.length > 0) {
    let bestMatch: {
      chunkIndex: number;
      startOffset: number;
      endOffset: number;
      confidence: number;
    } | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const normalizedChunk = normalizeText(chunk.content);
      const confidence = calculateCitationConfidence(
        normalizedSearch,
        normalizedChunk
      );

      if (!bestMatch || confidence > bestMatch.confidence) {
        const matchIndex = chunk.content
          .toLowerCase()
          .indexOf(searchText.toLowerCase());
        bestMatch = {
          chunkIndex: i,
          startOffset: matchIndex !== -1 ? matchIndex : 0,
          endOffset:
            matchIndex !== -1 ? matchIndex + searchText.length : chunk.content.length,
          confidence,
        };
      }
    }

    return bestMatch
      ? {
          chunkIndex: bestMatch.chunkIndex,
          startOffset: bestMatch.startOffset,
          endOffset: bestMatch.endOffset,
        }
      : null;
  }

  const normalizedContent = sourceContent.toLowerCase();
  const searchLower = searchText.toLowerCase();
  const matchIndex = normalizedContent.indexOf(searchLower);

  if (matchIndex !== -1) {
    return {
      chunkIndex: 0,
      startOffset: matchIndex,
      endOffset: matchIndex + searchText.length,
    };
  }

  return null;
}

export class CitationManager {
  private citations: Citation[] = [];
  private sourceContents: Map<string, string> = new Map();
  private citationMatches: Map<number | string, CitationMatch> = new Map();

  setCitations(citations: Citation[]): void {
    this.citations = citations;
    this.citationMatches.clear();
  }

  setSourceContent(sourceId: string, content: string): void {
    this.sourceContents.set(sourceId, content);
  }

  getCitation(citationId: number | string): Citation | undefined {
    return this.citations.find((c) => c.citation_id === citationId);
  }

  getSourceContent(sourceId: string): string | undefined {
    return this.sourceContents.get(sourceId);
  }

  getHighlightedExcerpt(
    citationId: number | string,
    searchText?: string
  ): HighlightedExcerpt | null {
    const citation = this.getCitation(citationId);
    if (!citation) return null;

    const sourceContent = this.sourceContents.get(citation.source_id);
    if (!sourceContent) return null;

    return generateHighlightedExcerpt(citation, sourceContent, searchText);
  }

  getCitationMatch(citationId: number | string): CitationMatch | null {
    if (this.citationMatches.has(citationId)) {
      return this.citationMatches.get(citationId)!;
    }

    const citation = this.getCitation(citationId);
    if (!citation) return null;

    const sourceContent = this.sourceContents.get(citation.source_id);
    if (!sourceContent) return null;

    const match = createCitationMatch(citation, sourceContent);
    this.citationMatches.set(citationId, match);

    return match;
  }

  getAllCitationMatches(): CitationMatch[] {
    return this.citations
      .map((c) => this.getCitationMatch(c.citation_id))
      .filter((m): m is CitationMatch => m !== null);
  }
}

export const citationManager = new CitationManager();
