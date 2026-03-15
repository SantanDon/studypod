/**
 * Search Service
 * Orchestrates semantic search operations
 */

export { ISearchService, SearchResult, SearchOptions } from './ISearchService';
export { SearchService } from './SearchService';

// Create singleton instance
import { SearchService } from './SearchService';

export const searchService = new SearchService();
