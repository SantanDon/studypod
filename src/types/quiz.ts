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
  correctAnswer?: number;
  explanation?: string;
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
  timeSpent: number;
}

export interface QuizSession {
  attemptId: string;
  quiz: Quiz;
  results: QuizResult[];
  currentQuestionIndex: number;
  startedAt: string;
  isComplete: boolean;
}

export interface QuizHistory {
  id?: string;
  startedAt?: string;
  results?: QuizResult[];
  quizId: string;
  notebookId: string;
  title: string;
  score: number;
  totalQuestions: number;
  completedAt: string;
  difficulty: QuestionDifficulty;
}
