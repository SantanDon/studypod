/**
 * Search Service Interface
 * Abstracts semantic search operations
 */

export interface SearchResult {
  id: string;
  sourceId: string;
  sourceTitle: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  [key: string]: unknown;
}

export interface ISearchService {
  /**
   * Search for content by query
   */
  search(query: string, notebookId: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Index content for a source
   */
  indexContent(sourceId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Remove indexed content for a source
   */
  removeIndex(sourceId: string): Promise<void>;

  /**
   * Clear all indexes
   */
  clearIndexes(): Promise<void>;

  /**
   * Check if the service is available
   */
  isAvailable(): Promise<boolean>;
}
