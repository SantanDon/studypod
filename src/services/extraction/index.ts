/**
 * Extraction Service
 * Orchestrates content extraction from various sources
 */

export { IExtractionService, ExtractedContent } from './IExtractionService';
export { ExtractionService } from './ExtractionService';

// Create singleton instance
import { ExtractionService } from './ExtractionService';

export const extractionService = new ExtractionService();
