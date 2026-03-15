import { z } from 'zod';

/**
 * Flashcard domain model
 * Represents a single flashcard for spaced repetition learning
 */
export const FlashcardSchema = z.object({
  id: z.string().describe('Unique identifier'),
  front: z.string().min(1).describe('Front side of card'),
  back: z.string().min(1).describe('Back side of card'),
  sourceId: z.string().describe('Source ID'),
  sourceTitle: z.string().describe('Source title'),
  cardType: z.enum(['definition', 'concept', 'fact']).describe('Card type'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('Difficulty level'),
  lastReviewed: z.string().datetime().nullable().describe('Last review timestamp'),
  nextReview: z.string().datetime().nullable().describe('Next review timestamp'),
  correctCount: z.number().nonnegative().describe('Number of correct reviews'),
  incorrectCount: z.number().nonnegative().describe('Number of incorrect reviews'),
  easeFactor: z.number().describe('Ease factor for spaced repetition'),
  interval: z.number().nonnegative().describe('Review interval in days'),
});

export type Flashcard = z.infer<typeof FlashcardSchema>;

/**
 * Input type for creating a new flashcard
 */
export const CreateFlashcardInputSchema = FlashcardSchema.omit({
  id: true,
  lastReviewed: true,
  nextReview: true,
  correctCount: true,
  incorrectCount: true,
  easeFactor: true,
  interval: true,
}).extend({
  lastReviewed: z.string().datetime().nullable().optional(),
  nextReview: z.string().datetime().nullable().optional(),
  correctCount: z.number().nonnegative().optional(),
  incorrectCount: z.number().nonnegative().optional(),
  easeFactor: z.number().optional(),
  interval: z.number().nonnegative().optional(),
});

export type CreateFlashcardInput = z.infer<typeof CreateFlashcardInputSchema>;

/**
 * Input type for updating a flashcard
 */
export const UpdateFlashcardInputSchema = FlashcardSchema.partial().omit({
  id: true,
  sourceId: true,
});

export type UpdateFlashcardInput = z.infer<typeof UpdateFlashcardInputSchema>;

/**
 * Flashcard deck domain model
 */
export const FlashcardDeckSchema = z.object({
  id: z.string().describe('Unique identifier'),
  notebookId: z.string().describe('Parent notebook ID'),
  name: z.string().min(1).describe('Deck name'),
  cards: z.array(FlashcardSchema).describe('Cards in deck'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

export type FlashcardDeck = z.infer<typeof FlashcardDeckSchema>;

/**
 * Flashcard review result
 */
export const FlashcardReviewResultSchema = z.object({
  cardId: z.string().describe('Card ID'),
  quality: z.number().min(0).max(5).describe('Review quality (0-5)'),
  reviewedAt: z.string().datetime().describe('Review timestamp'),
});

export type FlashcardReviewResult = z.infer<typeof FlashcardReviewResultSchema>;

/**
 * Flashcard statistics
 */
export const FlashcardStatsSchema = z.object({
  totalCards: z.number().nonnegative().describe('Total cards'),
  cardsDue: z.number().nonnegative().describe('Cards due for review'),
  cardsLearning: z.number().nonnegative().describe('Cards being learned'),
  cardsMastered: z.number().nonnegative().describe('Mastered cards'),
  averageAccuracy: z.number().min(0).max(1).describe('Average accuracy (0-1)'),
});

export type FlashcardStats = z.infer<typeof FlashcardStatsSchema>;
