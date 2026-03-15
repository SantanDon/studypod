import { describe, it, expect } from 'vitest';
import { NotebookFactory } from '@/factories/NotebookFactory';
import { NotebookSchema } from '@/types/domain';

describe('NotebookFactory', () => {
  describe('create', () => {
    it('should create a notebook with required fields', () => {
      const input = {
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed' as const,
      };

      const notebook = NotebookFactory.create(input);

      expect(notebook).toBeDefined();
      expect(notebook.id).toBeDefined();
      expect(notebook.title).toBe(input.title);
      expect(notebook.user_id).toBe(input.user_id);
      expect(notebook.created_at).toBeDefined();
      expect(notebook.updated_at).toBeDefined();
    });

    it('should validate against schema', () => {
      const input = {
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed' as const,
      };

      const notebook = NotebookFactory.create(input);

      expect(() => NotebookSchema.parse(notebook)).not.toThrow();
    });

    it('should include optional fields', () => {
      const input = {
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed' as const,
        description: 'A test notebook',
        icon: '📚',
      };

      const notebook = NotebookFactory.create(input);

      expect(notebook.description).toBe(input.description);
      expect(notebook.icon).toBe(input.icon);
    });
  });

  describe('fromData', () => {
    it('should create a notebook from partial data', () => {
      const data = {
        id: 'notebook-1',
        title: 'Test Notebook',
      };

      const notebook = NotebookFactory.fromData(data);

      expect(notebook.id).toBe(data.id);
      expect(notebook.title).toBe(data.title);
      expect(notebook.user_id).toBe('');
      expect(notebook.generation_status).toBe('pending');
    });

    it('should use defaults for missing fields', () => {
      const notebook = NotebookFactory.fromData({});

      expect(notebook.id).toBeDefined();
      expect(notebook.title).toBe('Untitled Notebook');
      expect(notebook.generation_status).toBe('pending');
    });
  });

  describe('createTest', () => {
    it('should create a test notebook', () => {
      const notebook = NotebookFactory.createTest();

      expect(notebook).toBeDefined();
      expect(notebook.id).toContain('test-notebook');
      expect(notebook.title).toBe('Test Notebook');
      expect(notebook.user_id).toBe('test-user');
    });

    it('should allow overrides', () => {
      const notebook = NotebookFactory.createTest({
        title: 'Custom Title',
        icon: '🎓',
      });

      expect(notebook.title).toBe('Custom Title');
      expect(notebook.icon).toBe('🎓');
    });

    it('should generate unique IDs', () => {
      const notebook1 = NotebookFactory.createTest();
      const notebook2 = NotebookFactory.createTest();

      expect(notebook1.id).not.toBe(notebook2.id);
    });
  });
});
