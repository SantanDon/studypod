/**
 * BM25 Search Implementation
 * 
 * Implements the Okapi BM25 ranking function for keyword-based search.
 * BM25 is a bag-of-words retrieval function that ranks documents based on
 * term frequency (TF), inverse document frequency (IDF), and document length.
 */

import { LocalNote, LocalSource } from "@/services/localStorageService";

export interface BM25Document {
  id: string;
  type: "note" | "source" | "chat";
  title: string;
  content: string;
  tokens: string[];
  metadata?: Record<string, unknown>;
}

export interface BM25Result {
  id: string;
  type: "note" | "source" | "chat";
  title: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  matchedTerms: string[];
}

export interface BM25Index {
  documents: BM25Document[];
  avgDocLength: number;
  docCount: number;
  termDocFreq: Map<string, number>;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "to", "was", "were", "will", "with", "this", "have", "had",
  "but", "not", "you", "all", "can", "her", "his", "one", "our",
  "out", "they", "we", "she", "what", "which", "their", "if", "do",
  "does", "how", "when", "where", "why", "who", "been", "being",
  "would", "could", "should", "may", "might", "must", "shall",
  "i", "me", "my", "myself", "your", "yours", "yourself",
  "him", "himself", "herself", "itself", "them", "themselves",
  "about", "above", "after", "again", "against", "before", "below",
  "between", "both", "during", "each", "few", "further", "here",
  "into", "just", "more", "most", "no", "nor", "only", "other",
  "over", "same", "so", "some", "such", "than", "then", "there",
  "these", "those", "through", "too", "under", "until", "up", "very",
  "also", "any", "because", "did", "doing", "down", "get", "got",
  "make", "made", "now", "off", "once", "own", "said", "say",
  "see", "seen", "since", "still", "take", "taken", "tell", "told",
  "think", "thought", "want", "wanted", "way", "well", "while", "yet"
]);

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Tokenize text into terms with stopword removal and normalization
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(token => 
      token.length > 2 && 
      !STOPWORDS.has(token) &&
      !/^\d+$/.test(token)
    );
}

/**
 * Build BM25 index from documents
 */
export function buildIndex(documents: BM25Document[]): BM25Index {
  const termDocFreq = new Map<string, number>();
  let totalLength = 0;
  
  for (const doc of documents) {
    const uniqueTerms = new Set(doc.tokens);
    totalLength += doc.tokens.length;
    
    for (const term of uniqueTerms) {
      termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
    }
  }
  
  return {
    documents,
    avgDocLength: documents.length > 0 ? totalLength / documents.length : 0,
    docCount: documents.length,
    termDocFreq
  };
}

/**
 * Calculate IDF (Inverse Document Frequency) for a term
 */
function calculateIDF(term: string, index: BM25Index): number {
  const docFreq = index.termDocFreq.get(term) || 0;
  if (docFreq === 0) return 0;
  
  return Math.log(
    (index.docCount - docFreq + 0.5) / (docFreq + 0.5) + 1
  );
}

/**
 * Calculate BM25 score for a document given a query
 */
function calculateBM25Score(
  queryTokens: string[],
  doc: BM25Document,
  index: BM25Index
): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matchedTerms: string[] = [];
  
  const termFreqMap = new Map<string, number>();
  for (const token of doc.tokens) {
    termFreqMap.set(token, (termFreqMap.get(token) || 0) + 1);
  }
  
  const docLength = doc.tokens.length;
  
  for (const queryTerm of queryTokens) {
    const tf = termFreqMap.get(queryTerm) || 0;
    if (tf === 0) continue;
    
    matchedTerms.push(queryTerm);
    
    const idf = calculateIDF(queryTerm, index);
    
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / index.avgDocLength));
    
    score += idf * (numerator / denominator);
  }
  
  return { score, matchedTerms };
}

/**
 * Create a document from LocalNote
 */
export function noteToDocument(note: LocalNote): BM25Document {
  const content = `${note.title} ${note.content}`;
  return {
    id: note.id,
    type: "note",
    title: note.title,
    content: note.content,
    tokens: tokenize(content),
    metadata: { created_at: note.created_at }
  };
}

/**
 * Create a document from LocalSource
 */
export function sourceToDocument(source: LocalSource): BM25Document {
  let content = source.content || "";
  
  if (source.metadata && typeof source.metadata === "object") {
    const chunks = (source.metadata as { chunks?: string[] }).chunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      content = chunks.join(" ") + " " + content;
    }
  }
  
  const fullContent = `${source.title} ${source.summary || ""} ${content}`;
  
  return {
    id: source.id,
    type: "source",
    title: source.title,
    content: content,
    tokens: tokenize(fullContent),
    metadata: { 
      type: source.type, 
      created_at: source.created_at 
    }
  };
}

/**
 * Check if content contains extraction error messages
 */
function hasExtractionError(content: string): boolean {
  const errorPatterns = [
    "extraction failed",
    "Unable to extract text",
    "PDF contains no extractable text",
    "extraction/OCR failed",
    "encrypted or password-protected",
    "corrupted or in an unsupported format"
  ];
  
  return errorPatterns.some(pattern => content.includes(pattern));
}

/**
 * Search documents using BM25 algorithm
 */
export function bm25Search(
  query: string,
  documents: BM25Document[],
  options: { limit?: number; minScore?: number } = {}
): BM25Result[] {
  const { limit = 20, minScore = 0.1 } = options;
  
  if (!query.trim() || documents.length === 0) return [];
  
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  
  const validDocuments = documents.filter(doc => 
    !hasExtractionError(doc.content) && doc.tokens.length > 0
  );
  
  const index = buildIndex(validDocuments);
  
  const results: BM25Result[] = [];
  
  for (const doc of validDocuments) {
    const { score, matchedTerms } = calculateBM25Score(queryTokens, doc, index);
    
    if (score >= minScore && matchedTerms.length > 0) {
      results.push({
        id: doc.id,
        type: doc.type,
        title: doc.title,
        content: doc.content,
        score,
        metadata: doc.metadata,
        matchedTerms
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, limit);
}

/**
 * Normalize BM25 scores to 0-1 range for combining with other search methods
 */
export function normalizeBM25Scores(results: BM25Result[]): BM25Result[] {
  if (results.length === 0) return [];
  
  const maxScore = Math.max(...results.map(r => r.score));
  if (maxScore === 0) return results;
  
  return results.map(r => ({
    ...r,
    score: r.score / maxScore
  }));
}

export default {
  tokenize,
  buildIndex,
  bm25Search,
  normalizeBM25Scores,
  noteToDocument,
  sourceToDocument
};
