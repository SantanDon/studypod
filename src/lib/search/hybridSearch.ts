/**
 * Hybrid Search Implementation
 * 
 * Combines BM25 (keyword) and semantic (embedding) search for improved results.
 * Uses Reciprocal Rank Fusion (RRF) for combining rankings from multiple methods.
 */

import {
  localStorageService,
  LocalNote,
  LocalSource,
} from "@/services/localStorageService";
import {
  bm25Search,
  normalizeBM25Scores,
  noteToDocument,
  sourceToDocument,
  BM25Document,
  BM25Result,
} from "./bm25Search";
import {
  semanticSearchNotes,
  semanticSearchSources,
  SemanticSearchResult,
} from "./semanticSearch";

export interface HybridSearchResult {
  id: string;
  type: "note" | "source" | "chat";
  title: string;
  content: string;
  score: number;
  bm25Score?: number;
  semanticScore?: number;
  foundBy: "bm25" | "semantic" | "both";
  metadata?: Record<string, unknown>;
  excerpt?: string;
  matchedTerms?: string[];
}

export interface HybridSearchOptions {
  types?: Array<"note" | "source">;
  notebookId?: string;
  limit?: number;
  minScore?: number;
  bm25Weight?: number;
  semanticWeight?: number;
  useRRF?: boolean;
  rrfK?: number;
}

const DEFAULT_BM25_WEIGHT = 0.4;
const DEFAULT_SEMANTIC_WEIGHT = 0.6;
const DEFAULT_RRF_K = 60;

/**
 * Calculate Reciprocal Rank Fusion score
 * RRF(d) = Σ 1 / (k + rank_i(d)) for each ranking i
 */
function calculateRRF(
  bm25Rank: number | null,
  semanticRank: number | null,
  k: number = DEFAULT_RRF_K
): number {
  let score = 0;
  
  if (bm25Rank !== null) {
    score += 1 / (k + bm25Rank);
  }
  
  if (semanticRank !== null) {
    score += 1 / (k + semanticRank);
  }
  
  return score;
}

/**
 * Extract excerpt from content around query terms
 */
function extractExcerpt(
  content: string,
  query: string,
  maxLength: number = 200
): string {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  let bestSentence = sentences[0] || "";
  let bestScore = 0;

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (sentenceLower.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  if (bestSentence.length > maxLength) {
    return bestSentence.substring(0, maxLength) + "...";
  }

  return bestSentence.trim();
}

/**
 * Merge and re-rank results using weighted combination or RRF
 */
function mergeResults(
  bm25Results: BM25Result[],
  semanticResults: SemanticSearchResult[],
  options: HybridSearchOptions
): HybridSearchResult[] {
  const {
    bm25Weight = DEFAULT_BM25_WEIGHT,
    semanticWeight = DEFAULT_SEMANTIC_WEIGHT,
    useRRF = true,
    rrfK = DEFAULT_RRF_K,
  } = options;

  const normalizedBM25 = normalizeBM25Scores(bm25Results);

  const bm25Map = new Map<string, { result: BM25Result; rank: number }>();
  normalizedBM25.forEach((result, index) => {
    bm25Map.set(`${result.type}:${result.id}`, { result, rank: index + 1 });
  });

  const semanticMap = new Map<string, { result: SemanticSearchResult; rank: number }>();
  semanticResults.forEach((result, index) => {
    semanticMap.set(`${result.type}:${result.id}`, { result, rank: index + 1 });
  });

  const allKeys = new Set([...bm25Map.keys(), ...semanticMap.keys()]);
  const merged: HybridSearchResult[] = [];

  for (const key of allKeys) {
    const bm25Entry = bm25Map.get(key);
    const semanticEntry = semanticMap.get(key);

    let combinedScore: number;
    let foundBy: "bm25" | "semantic" | "both";

    if (useRRF) {
      combinedScore = calculateRRF(
        bm25Entry?.rank ?? null,
        semanticEntry?.rank ?? null,
        rrfK
      );
    } else {
      const bm25Score = bm25Entry?.result.score ?? 0;
      const semanticScore = semanticEntry?.result.score ?? 0;
      combinedScore = bm25Weight * bm25Score + semanticWeight * semanticScore;
    }

    if (bm25Entry && semanticEntry) {
      foundBy = "both";
    } else if (bm25Entry) {
      foundBy = "bm25";
    } else {
      foundBy = "semantic";
    }

    const baseResult = bm25Entry?.result || semanticEntry?.result;
    if (!baseResult) continue;

    merged.push({
      id: baseResult.id,
      type: baseResult.type,
      title: baseResult.title,
      content: baseResult.content,
      score: combinedScore,
      bm25Score: bm25Entry?.result.score,
      semanticScore: semanticEntry?.result.score,
      foundBy,
      metadata: baseResult.metadata,
      excerpt: semanticEntry?.result.excerpt,
      matchedTerms: bm25Entry?.result.matchedTerms,
    });
  }

  merged.sort((a, b) => b.score - a.score);

  return merged;
}

/**
 * Perform hybrid search on notes
 */
async function hybridSearchNotes(
  query: string,
  notebookId: string,
  options: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const notes = localStorageService.getNotes(notebookId);
  const documents: BM25Document[] = notes.map(noteToDocument);
  
  const bm25Results = bm25Search(query, documents, {
    limit: options.limit || 50,
    minScore: 0.01,
  });

  let semanticResults: SemanticSearchResult[] = [];
  try {
    semanticResults = await semanticSearchNotes(query, notebookId, {
      limit: options.limit || 50,
      minScore: options.minScore || 0.1,
    });
  } catch (error) {
    console.warn("Semantic search failed for notes, using BM25 only:", error);
  }

  const merged = mergeResults(bm25Results, semanticResults, options);

  return merged.map((result) => ({
    ...result,
    excerpt: result.excerpt || extractExcerpt(result.content, query),
  }));
}

/**
 * Perform hybrid search on sources
 */
async function hybridSearchSources(
  query: string,
  notebookId: string,
  options: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const sources = localStorageService.getSources(notebookId);
  const documents: BM25Document[] = sources.map(sourceToDocument);
  
  const bm25Results = bm25Search(query, documents, {
    limit: options.limit || 50,
    minScore: 0.01,
  });

  let semanticResults: SemanticSearchResult[] = [];
  try {
    semanticResults = await semanticSearchSources(query, notebookId, {
      limit: options.limit || 50,
      minScore: options.minScore || 0.1,
    });
  } catch (error) {
    console.warn("Semantic search failed for sources, using BM25 only:", error);
  }

  const merged = mergeResults(bm25Results, semanticResults, options);

  return merged.map((result) => ({
    ...result,
    excerpt: result.excerpt || extractExcerpt(result.content, query),
  }));
}

/**
 * Main hybrid search function - searches across notes and sources
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const {
    types = ["note", "source"],
    notebookId,
    limit = 20,
    minScore = 0.01,
  } = options;

  if (!query.trim()) return [];
  if (!notebookId) return [];

  const allResults: HybridSearchResult[] = [];

  const searchPromises: Promise<HybridSearchResult[]>[] = [];

  if (types.includes("note")) {
    searchPromises.push(hybridSearchNotes(query, notebookId, options));
  }

  if (types.includes("source")) {
    searchPromises.push(hybridSearchSources(query, notebookId, options));
  }

  const results = await Promise.all(searchPromises);
  for (const resultSet of results) {
    allResults.push(...resultSet);
  }

  allResults.sort((a, b) => b.score - a.score);

  const filtered = allResults.filter((r) => r.score >= minScore);

  return filtered.slice(0, limit);
}

/**
 * Quick keyword-only search (when semantic search is not needed or available)
 */
export function keywordOnlySearch(
  query: string,
  notebookId: string,
  options: { types?: Array<"note" | "source">; limit?: number } = {}
): HybridSearchResult[] {
  const { types = ["note", "source"], limit = 20 } = options;

  if (!query.trim() || !notebookId) return [];

  const documents: BM25Document[] = [];

  if (types.includes("note")) {
    const notes = localStorageService.getNotes(notebookId);
    documents.push(...notes.map(noteToDocument));
  }

  if (types.includes("source")) {
    const sources = localStorageService.getSources(notebookId);
    documents.push(...sources.map(sourceToDocument));
  }

  const bm25Results = bm25Search(query, documents, { limit, minScore: 0.01 });

  return bm25Results.map((result) => ({
    id: result.id,
    type: result.type,
    title: result.title,
    content: result.content,
    score: result.score,
    bm25Score: result.score,
    foundBy: "bm25" as const,
    metadata: result.metadata,
    excerpt: extractExcerpt(result.content, query),
    matchedTerms: result.matchedTerms,
  }));
}

export default {
  hybridSearch,
  keywordOnlySearch,
};
