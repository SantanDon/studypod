import { IExtractionService, ExtractedContent } from './IExtractionService';
import { enhancedPDFExtraction } from '@/lib/extraction/pdfExtractor';
import { extractWebContent } from '@/lib/extraction/webExtractor';
import { extractYoutubeTranscript } from '@/lib/extraction/youtubeExtractor';
import { extractAudio as extractAudioFile } from '@/lib/extraction/audioExtractor';

/**
 * Extraction Service
 * Orchestrates content extraction from various sources
 */
export class ExtractionService implements IExtractionService {

  constructor() {
  }

  /**
   * Extract content from a PDF file
   */
  async extractPDF(file: File): Promise<ExtractedContent> {
    if (!file.type.includes('pdf')) {
      throw new Error('File is not a PDF');
    }
    const result = await enhancedPDFExtraction(file);
    return {
      title: file.name,
      content: result.content,
      metadata: {
        language: 'unknown',
      }
    };
  }

  /**
   * Extract content from a website URL
   */
  async extractWebsite(url: string): Promise<ExtractedContent> {
    if (!this.isValidUrl(url)) {
      throw new Error('Invalid URL');
    }
    const result = await extractWebContent(url);
    return {
      title: result.title,
      content: result.content,
      metadata: {
        language: 'unknown',
      }
    };
  }

  /**
   * Extract content from a YouTube video
   */
  async extractYouTube(url: string): Promise<ExtractedContent> {
    if (!this.isYouTubeUrl(url)) {
      throw new Error('Invalid YouTube URL');
    }
    const result = await extractYoutubeTranscript(url);
    return {
      title: result.title,
      content: result.content,
      metadata: {
        language: 'unknown',
      }
    };
  }

  /**
   * Extract content from an audio file
   */
  async extractAudio(file: File): Promise<ExtractedContent> {
    if (!file.type.includes('audio')) {
      throw new Error('File is not an audio file');
    }
    const result = await extractAudioFile(file);
    return {
      title: file.name,
      content: result.text,
      metadata: {
        language: result.language || 'unknown',
      }
    };
  }

  /**
   * Extract content from plain text
   */
  async extractText(text: string, title?: string): Promise<ExtractedContent> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text content is empty');
    }
    return {
      title: title || 'Text Content',
      content: text,
      metadata: {
        language: 'unknown',
      },
    };
  }

  /**
   * Detect the type of content and extract accordingly
   */
  async extract(
    input: File | string,
    type?: 'pdf' | 'website' | 'youtube' | 'audio' | 'text'
  ): Promise<ExtractedContent> {
    if (typeof input === 'string') {
      // It's a URL or text
      if (type === 'youtube' || this.isYouTubeUrl(input)) {
        return this.extractYouTube(input);
      } else if (type === 'website' || this.isValidUrl(input)) {
        return this.extractWebsite(input);
      } else if (type === 'text') {
        return this.extractText(input);
      } else {
        // Try to detect
        if (this.isYouTubeUrl(input)) {
          return this.extractYouTube(input);
        } else if (this.isValidUrl(input)) {
          return this.extractWebsite(input);
        } else {
          return this.extractText(input);
        }
      }
    } else {
      // It's a file
      if (type === 'pdf' || input.type.includes('pdf')) {
        return this.extractPDF(input);
      } else if (type === 'audio' || input.type.includes('audio')) {
        return this.extractAudio(input);
      } else {
        throw new Error(`Unsupported file type: ${input.type}`);
      }
    }
  }

  /**
   * Check if a string is a valid URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a URL is a YouTube URL
   */
  private isYouTubeUrl(url: string): boolean {
    return /(?:youtube\.com|youtu\.be)/.test(url);
  }
}
