/**
 * AI Service Interface
 * Abstracts AI operations (LLM inference, embeddings, etc.)
 */

export interface AIGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  [key: string]: unknown;
}

export interface EmbeddingOptions {
  model?: string;
  [key: string]: unknown;
}

export interface IAIService {
  /**
   * Generate a response from an LLM
   */
  generateResponse(
    prompt: string,
    context?: string,
    options?: AIGenerationOptions
  ): Promise<string>;

  /**
   * Generate embeddings for text
   */
  generateEmbeddings(text: string, options?: EmbeddingOptions): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts
   */
  generateBatchEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;

  /**
   * Generate a title for content
   */
  generateTitle(content: string): Promise<string>;

  /**
   * Generate a summary for content
   */
  generateSummary(content: string, maxLength?: number): Promise<string>;

  /**
   * Check if the service is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the current provider name
   */
  getProvider(): string;
}
