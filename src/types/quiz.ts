export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionType = 'multiple_choice' | 'true_false';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  sourceId: string;
  difficulty: QuestionDifficulty;
  type: QuestionType;
}

export interface Quiz {
  id: string;
  notebookId: string;
  title: string;
  questions: QuizQuestion[];
  createdAt: string;
  score?: number;
  completedAt?: string;
  difficulty: QuestionDifficulty;
}

export interface QuizResult {
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
  timeSpent: number;
}

export interface QuizSession {
  quiz: Quiz;
  results: QuizResult[];
  currentQuestionIndex: number;
  startedAt: string;
  isComplete: boolean;
}

export interface QuizHistory {
  quizId: string;
  notebookId: string;
  title: string;
  score: number;
  totalQuestions: number;
  completedAt: string;
  difficulty: QuestionDifficulty;
}
