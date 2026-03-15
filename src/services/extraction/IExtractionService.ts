/**
 * Extraction Service Interface
 * Abstracts content extraction from various sources
 */

export interface ExtractedContent {
  title: string;
  content: string;
  summary?: string;
  metadata?: {
    author?: string;
    date?: string;
    keywords?: string[];
    language?: string;
    [key: string]: unknown;
  };
}

export interface IExtractionService {
  /**
   * Extract content from a PDF file
   */
  extractPDF(file: File): Promise<ExtractedContent>;

  /**
   * Extract content from a website URL
   */
  extractWebsite(url: string): Promise<ExtractedContent>;

  /**
   * Extract content from a YouTube video
   */
  extractYouTube(url: string): Promise<ExtractedContent>;

  /**
   * Extract content from an audio file
   */
  extractAudio(file: File): Promise<ExtractedContent>;

  /**
   * Extract content from plain text
   */
  extractText(text: string, title?: string): Promise<ExtractedContent>;

  /**
   * Detect the type of content and extract accordingly
   */
  extract(input: File | string, type?: 'pdf' | 'website' | 'youtube' | 'audio' | 'text'): Promise<ExtractedContent>;
}
