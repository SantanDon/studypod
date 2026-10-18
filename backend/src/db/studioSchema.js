import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users, notebooks } from './schema.js';

const owned = () => ({
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

export const studioDecks = sqliteTable('studio_decks', {
  ...owned(), name: text('name').notNull(), cards: text('cards').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const studioMaps = sqliteTable('studio_maps', {
  ...owned(), title: text('title').notNull(), nodes: text('nodes').notNull(), edges: text('edges').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const studioQuizzes = sqliteTable('studio_quizzes', {
  ...owned(), title: text('title').notNull(), difficulty: text('difficulty').notNull(),
  questions: text('questions').notNull(), createdAt: text('created_at').notNull(),
});
export const studioAttempts = sqliteTable('studio_attempts', {
  ...owned(), quizId: text('quiz_id').notNull().references(() => studioQuizzes.id, { onDelete: 'cascade' }),
  results: text('results').notNull(), score: integer('score').notNull(),
  totalQuestions: integer('total_questions').notNull(),
  startedAt: text('started_at'), completedAt: text('completed_at').notNull(),
});
