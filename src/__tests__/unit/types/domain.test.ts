import { describe, it, expect } from 'vitest';
import {
  NotebookSchema,
  SourceSchema,
  ChatMessageSchema,
  FlashcardSchema,
  QuizSchema,
  PodcastSchema,
} from '@/types/domain';

describe('Domain Model Schemas', () => {
  describe('NotebookSchema', () => {
    it('should validate a valid notebook', () => {
      const notebook = {
        id: 'notebook-1',
        title: 'Test Notebook',
        user_id: 'user-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: 'completed' as const,
      };

      expect(() => NotebookSchema.parse(notebook)).not.toThrow();
    });

    it('should reject invalid generation_status', () => {
      const notebook = {
        id: 'notebook-1',
        title: 'Test Notebook',
        user_id: 'user-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: 'invalid',
      };

      expect(() => NotebookSchema.parse(notebook)).toThrow();
    });

    it('should reject empty title', () => {
      const notebook = {
        id: 'notebook-1',
        title: '',
        user_id: 'user-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: 'completed',
      };

      expect(() => NotebookSchema.parse(notebook)).toThrow();
    });
  });

  describe('SourceSchema', () => {
    it('should validate a valid source', () => {
      const source = {
        id: 'source-1',
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(() => SourceSchema.parse(source)).not.toThrow();
    });

    it('should reject invalid source type', () => {
      const source = {
        id: 'source-1',
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'invalid',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(() => SourceSchema.parse(source)).toThrow();
    });
  });

  describe('ChatMessageSchema', () => {
    it('should validate a valid chat message', () => {
      const message = {
        id: 'message-1',
        notebook_id: 'notebook-1',
        message: {
          type: 'human' as const,
          content: 'Hello',
        },
        created_at: new Date().toISOString(),
      };

      expect(() => ChatMessageSchema.parse(message)).not.toThrow();
    });

    it('should validate message with citations', () => {
      const message = {
        id: 'message-1',
        notebook_id: 'notebook-1',
        message: {
          type: 'ai' as const,
          content: {
            segments: [
              {
                text: 'This is a response',
                citation_id: 1,
              },
            ],
            citations: [
              {
                citation_id: 1,
                source_id: 'source-1',
                source_title: 'Source',
                source_type: 'pdf',
              },
            ],
          },
        },
        created_at: new Date().toISOString(),
      };

      expect(() => ChatMessageSchema.parse(message)).not.toThrow();
    });
  });

  describe('FlashcardSchema', () => {
    it('should validate a valid flashcard', () => {
      const flashcard = {
        id: 'card-1',
        front: 'What is 2+2?',
        back: '4',
        sourceId: 'source-1',
        sourceTitle: 'Math',
        cardType: 'fact' as const,
        difficulty: 'easy' as const,
        lastReviewed: null,
        nextReview: null,
        correctCount: 0,
        incorrectCount: 0,
        easeFactor: 2.5,
        interval: 1,
      };

      expect(() => FlashcardSchema.parse(flashcard)).not.toThrow();
    });

    it('should reject invalid difficulty', () => {
      const flashcard = {
        id: 'card-1',
        front: 'What is 2+2?',
        back: '4',
        sourceId: 'source-1',
        sourceTitle: 'Math',
        cardType: 'fact',
        difficulty: 'invalid',
        lastReviewed: null,
        nextReview: null,
        correctCount: 0,
        incorrectCount: 0,
        easeFactor: 2.5,
        interval: 1,
      };

      expect(() => FlashcardSchema.parse(flashcard)).toThrow();
    });
  });

  describe('QuizSchema', () => {
    it('should validate a valid quiz', () => {
      const quiz = {
        id: 'quiz-1',
        notebookId: 'notebook-1',
        title: 'Test Quiz',
        questions: [
          {
            id: 'q-1',
            question: 'What is 2+2?',
            options: ['3', '4', '5'],
            correctAnswer: 1,
            explanation: 'Because 2+2=4',
            sourceId: 'source-1',
            difficulty: 'easy' as const,
            type: 'multiple_choice' as const,
          },
        ],
        createdAt: new Date().toISOString(),
        difficulty: 'easy' as const,
      };

      expect(() => QuizSchema.parse(quiz)).not.toThrow();
    });
  });

  describe('PodcastSchema', () => {
    it('should validate a valid podcast', () => {
      const podcast = {
        id: 'podcast-1',
        notebook_id: 'notebook-1',
        title: 'Test Podcast',
        created_at: new Date().toISOString(),
        audio_blob_id: 'blob-1',
      };

      expect(() => PodcastSchema.parse(podcast)).not.toThrow();
    });

    it('should allow optional fields', () => {
      const podcast = {
        id: 'podcast-1',
        notebook_id: 'notebook-1',
        title: 'Test Podcast',
        created_at: new Date().toISOString(),
        audio_blob_id: 'blob-1',
        duration: 300,
        script: 'Podcast script',
        speakers: ['Host 1', 'Host 2'],
      };

      expect(() => PodcastSchema.parse(podcast)).not.toThrow();
    });
  });
});
