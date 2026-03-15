/**
 * AI Service
 * Orchestrates AI operations (LLM inference, embeddings, etc.)
 */

export type { IAIService, AIGenerationOptions, EmbeddingOptions } from './IAIService';
export { AIService } from './AIService';

// Create singleton instance
import { AIService } from './AIService';

export const aiService = new AIService();
