export type CardType = 'definition' | 'concept' | 'fact';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  sourceId: string;
  sourceTitle: string;
  cardType: CardType;
  difficulty: 'easy' | 'medium' | 'hard';
  lastReviewed: string | null;
  nextReview: string | null;
  correctCount: number;
  incorrectCount: number;
  easeFactor: number;
  interval: number;
}

export interface FlashcardDeck {
  id: string;
  notebookId: string;
  name: string;
  cards: Flashcard[];
  createdAt: string;
  updatedAt: string;
}

export interface FlashcardReviewResult {
  cardId: string;
  quality: 0 | 1 | 2 | 3 | 4 | 5;
  reviewedAt: string;
}

export interface FlashcardStats {
  totalCards: number;
  cardsDue: number;
  cardsLearning: number;
  cardsMastered: number;
  averageAccuracy: number;
}
