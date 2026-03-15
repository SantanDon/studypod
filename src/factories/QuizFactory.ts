import { Quiz, QuizQuestion, CreateQuizInput } from '@/types/domain';

/**
 * Factory for creating Quiz domain objects
 */
export class QuizFactory {
  /**
   * Create a new quiz instance
   */
  static create(input: CreateQuizInput): Quiz {
    return {
      id: this.generateId(),
      ...input,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create a quiz from existing data
   */
  static fromData(data: Partial<Quiz>): Quiz {
    return {
      id: data.id || this.generateId(),
      notebookId: data.notebookId || '',
      title: data.title || 'Untitled Quiz',
      questions: data.questions || [],
      createdAt: data.createdAt || new Date().toISOString(),
      score: data.score,
      completedAt: data.completedAt,
      difficulty: data.difficulty || 'medium',
    };
  }

  /**
   * Create a test quiz
   */
  static createTest(overrides?: Partial<Quiz>): Quiz {
    const question: QuizQuestion = {
      id: 'test-q-1',
      question: 'What is 2 + 2?',
      options: ['3', '4', '5', '6'],
      correctAnswer: 1,
      explanation: '2 + 2 = 4',
      sourceId: 'test-source',
      difficulty: 'easy',
      type: 'multiple_choice',
    };

    return {
      id: 'test-quiz-' + Math.random().toString(36).substr(2, 9),
      notebookId: 'test-notebook',
      title: 'Test Quiz',
      questions: [question],
      createdAt: new Date().toISOString(),
      difficulty: 'easy',
      ...overrides,
    };
  }

  /**
   * Create a quiz question
   */
  static createQuestion(overrides?: Partial<QuizQuestion>): QuizQuestion {
    return {
      id: 'q-' + Math.random().toString(36).substr(2, 9),
      question: 'Sample question?',
      options: ['Option A', 'Option B', 'Option C'],
      correctAnswer: 0,
      explanation: 'This is the correct answer',
      sourceId: 'source-id',
      difficulty: 'medium',
      type: 'multiple_choice',
      ...overrides,
    };
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
