import { z } from 'zod';

/**
 * Quiz question domain model
 */
export const QuizQuestionSchema = z.object({
  id: z.string().describe('Unique identifier'),
  question: z.string().min(1).describe('Question text'),
  options: z.array(z.string().min(1)).min(2).describe('Answer options'),
  correctAnswer: z.number().nonnegative().describe('Index of correct answer'),
  explanation: z.string().describe('Explanation for correct answer'),
  sourceId: z.string().describe('Source ID'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('Difficulty level'),
  type: z.enum(['multiple_choice', 'true_false']).describe('Question type'),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/**
 * Quiz domain model
 */
export const QuizSchema = z.object({
  id: z.string().describe('Unique identifier'),
  notebookId: z.string().describe('Parent notebook ID'),
  title: z.string().min(1).describe('Quiz title'),
  questions: z.array(QuizQuestionSchema).describe('Quiz questions'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  score: z.number().optional().describe('Quiz score'),
  completedAt: z.string().datetime().optional().describe('Completion timestamp'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('Overall difficulty'),
});

export type Quiz = z.infer<typeof QuizSchema>;

/**
 * Input type for creating a new quiz
 */
export const CreateQuizInputSchema = QuizSchema.omit({
  id: true,
  createdAt: true,
  score: true,
  completedAt: true,
});

export type CreateQuizInput = z.infer<typeof CreateQuizInputSchema>;

/**
 * Quiz result for a single question
 */
export const QuizResultSchema = z.object({
  questionId: z.string().describe('Question ID'),
  selectedAnswer: z.number().nonnegative().describe('Selected answer index'),
  isCorrect: z.boolean().describe('Whether answer is correct'),
  timeSpent: z.number().nonnegative().describe('Time spent in milliseconds'),
});

export type QuizResult = z.infer<typeof QuizResultSchema>;

/**
 * Quiz session domain model
 */
export const QuizSessionSchema = z.object({
  quiz: QuizSchema.describe('Quiz'),
  results: z.array(QuizResultSchema).describe('Results so far'),
  currentQuestionIndex: z.number().nonnegative().describe('Current question index'),
  startedAt: z.string().datetime().describe('Session start timestamp'),
  isComplete: z.boolean().describe('Whether session is complete'),
});

export type QuizSession = z.infer<typeof QuizSessionSchema>;

/**
 * Quiz history entry
 */
export const QuizHistorySchema = z.object({
  quizId: z.string().describe('Quiz ID'),
  notebookId: z.string().describe('Notebook ID'),
  title: z.string().describe('Quiz title'),
  score: z.number().describe('Score'),
  totalQuestions: z.number().nonnegative().describe('Total questions'),
  completedAt: z.string().datetime().describe('Completion timestamp'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('Difficulty level'),
});

export type QuizHistory = z.infer<typeof QuizHistorySchema>;
