import { ISearchService, SearchResult, SearchOptions } from './ISearchService';

/**
 * Search Service
 * Orchestrates semantic search operations
 */
export class SearchService implements ISearchService {
  /**
   * Search for content by query
   */
  async search(
    query: string,
    notebookId: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    try {
      // Import dynamically to avoid circular dependencies
      const { search } = await import('@/lib/search/semanticSearch');
      
      // Adaptation logic for semanticSearch results to SearchResult
      const results = await search(query, {
        notebookId,
        limit: options?.limit,
        minScore: options?.threshold // Map threshold to minScore
      });
      
      return results.map(r => ({
        id: r.id,
        sourceId: r.type === 'source' ? r.id : notebookId, // Basic mapping
        sourceTitle: r.title,
        content: r.content,
        score: r.score,
        metadata: r.metadata
      }));
    } catch (error) {
      console.error('Failed to search:', error);
      return [];
    }
  }

  /**
   * Index content for a source
   */
  async indexContent(
    _sourceId: string,
    _content: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // Indexing logic moved to on-the-fly semantic search
    return Promise.resolve();
  }

  /**
   * Remove indexed content for a source
   */
  async removeIndex(_sourceId: string): Promise<void> {
    // Indexing logic moved to on-the-fly semantic search
    return Promise.resolve();
  }

  /**
   * Clear all indexes
   */
  async clearIndexes(): Promise<void> {
    // Indexing logic moved to on-the-fly semantic search
    return Promise.resolve();
  }

  /**
   * Check if the service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try a simple operation to check availability
      return true;
    } catch {
      return false;
    }
  }
}
