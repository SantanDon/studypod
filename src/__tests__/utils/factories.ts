/**
 * Test Data Factories
 * Factories for creating test data
 */

import {
  NotebookFactory,
  SourceFactory,
  ChatMessageFactory,
  FlashcardFactory,
  QuizFactory,
  PodcastFactory,
} from '@/factories';
import {
  Notebook,
  Source,
  ChatMessage,
  Flashcard,
  Quiz,
  Podcast,
} from '@/types/domain';

/**
 * Create a test notebook
 */
export function createTestNotebook(overrides?: Partial<Notebook>): Notebook {
  return NotebookFactory.createTest(overrides);
}

/**
 * Create multiple test notebooks
 */
export function createTestNotebooks(count: number, overrides?: Partial<Notebook>): Notebook[] {
  return Array.from({ length: count }, () => createTestNotebook(overrides));
}

/**
 * Create a test source
 */
export function createTestSource(overrides?: Partial<Source>): Source {
  return SourceFactory.createTest(overrides);
}

/**
 * Create multiple test sources
 */
export function createTestSources(count: number, overrides?: Partial<Source>): Source[] {
  return Array.from({ length: count }, () => createTestSource(overrides));
}

/**
 * Create a test chat message
 */
export function createTestChatMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return ChatMessageFactory.createTest(overrides);
}

/**
 * Create multiple test chat messages
 */
export function createTestChatMessages(count: number, overrides?: Partial<ChatMessage>): ChatMessage[] {
  return Array.from({ length: count }, () => createTestChatMessage(overrides));
}

/**
 * Create a test flashcard
 */
export function createTestFlashcard(overrides?: Partial<Flashcard>): Flashcard {
  return FlashcardFactory.createTest(overrides);
}

/**
 * Create multiple test flashcards
 */
export function createTestFlashcards(count: number, overrides?: Partial<Flashcard>): Flashcard[] {
  return Array.from({ length: count }, () => createTestFlashcard(overrides));
}

/**
 * Create a test quiz
 */
export function createTestQuiz(overrides?: Partial<Quiz>): Quiz {
  return QuizFactory.createTest(overrides);
}

/**
 * Create a test podcast
 */
export function createTestPodcast(overrides?: Partial<Podcast>): Podcast {
  return PodcastFactory.createTest(overrides);
}
