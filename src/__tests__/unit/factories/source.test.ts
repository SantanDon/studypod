import { describe, it, expect } from 'vitest';
import { SourceFactory } from '@/factories/SourceFactory';
import { SourceSchema } from '@/types/domain';

describe('SourceFactory', () => {
  describe('create', () => {
    it('should create a source with required fields', () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf' as const,
      };

      const source = SourceFactory.create(input);

      expect(source).toBeDefined();
      expect(source.id).toBeDefined();
      expect(source.title).toBe(input.title);
      expect(source.notebook_id).toBe(input.notebook_id);
      expect(source.type).toBe(input.type);
    });

    it('should validate against schema', () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'website' as const,
      };

      const source = SourceFactory.create(input);

      expect(() => SourceSchema.parse(source)).not.toThrow();
    });
  });

  describe('createTest', () => {
    it('should create a test source', () => {
      const source = SourceFactory.createTest();

      expect(source).toBeDefined();
      expect(source.id).toContain('test-source');
      expect(source.title).toBe('Test Source');
      expect(source.type).toBe('text');
    });

    it('should allow overrides', () => {
      const source = SourceFactory.createTest({
        title: 'Custom Source',
        type: 'youtube',
      });

      expect(source.title).toBe('Custom Source');
      expect(source.type).toBe('youtube');
    });
  });

  describe('createPDF', () => {
    it('should create a PDF source', () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'PDF Document',
      };

      const source = SourceFactory.createPDF(input);

      expect(source.type).toBe('pdf');
      expect(source.title).toBe(input.title);
    });
  });

  describe('createWebsite', () => {
    it('should create a website source', () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'Website',
        url: 'https://example.com',
      };

      const source = SourceFactory.createWebsite(input);

      expect(source.type).toBe('website');
      expect(source.url).toBe(input.url);
    });
  });

  describe('createYouTube', () => {
    it('should create a YouTube source', () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'YouTube Video',
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      };

      const source = SourceFactory.createYouTube(input);

      expect(source.type).toBe('youtube');
      expect(source.url).toBe(input.url);
    });
  });
});
