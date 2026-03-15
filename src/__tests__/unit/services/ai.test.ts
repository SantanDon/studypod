import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIService } from '@/services/ai/AIService';

describe('AIService', () => {
  let service: AIService;

  beforeEach(() => {
    service = new AIService();
    vi.clearAllMocks();
  });

  describe('generateTitle', () => {
    it('should generate a title for content', async () => {
      const content = 'This is a long piece of content about machine learning and AI.';
      
      // Mock the generateResponse method
      vi.spyOn(service, 'generateResponse').mockResolvedValue('Machine Learning Basics');

      const title = await service.generateTitle(content);

      expect(title).toBe('Machine Learning Basics');
      expect(service.generateResponse).toHaveBeenCalled();
    });

    it('should handle empty content', async () => {
      vi.spyOn(service, 'generateResponse').mockResolvedValue('Untitled');

      const title = await service.generateTitle('');

      expect(title).toBe('Untitled');
    });
  });

  describe('generateSummary', () => {
    it('should generate a summary for content', async () => {
      const content = 'This is a long piece of content that needs to be summarized.';
      
      vi.spyOn(service, 'generateResponse').mockResolvedValue('A summary of the content');

      const summary = await service.generateSummary(content);

      expect(summary).toBe('A summary of the content');
      expect(service.generateResponse).toHaveBeenCalled();
    });

    it('should respect max length parameter', async () => {
      const content = 'Long content';
      
      vi.spyOn(service, 'generateResponse').mockResolvedValue('Short');

      const summary = await service.generateSummary(content, 100);

      expect(summary).toBe('Short');
    });
  });

  describe('getProvider', () => {
    it('should return the current provider', () => {
      const provider = service.getProvider();
      expect(provider).toBe('groq');
    });
  });

  describe('isAvailable', () => {
    it('should check if service is available', async () => {
      vi.spyOn(service, 'generateResponse').mockResolvedValue('test');

      const available = await service.isAvailable();

      expect(available).toBe(true);
    });

    it('should return false if service is unavailable', async () => {
      vi.spyOn(service, 'generateResponse').mockRejectedValue(new Error('Service unavailable'));

      const available = await service.isAvailable();

      expect(available).toBe(false);
    });
  });
});
