// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureStudioSchema } from '../db/studioBootstrap.js';
import { createStudioRepository } from '../services/studioRepository.js';

let client, db, repo;
const card = { id: 'c1', front: 'What?', back: 'Cedar', sourceId: 'source1' };
const question = { id: 'q1', question: 'Which tree?', options: ['Cedar', 'Oak'], correctAnswer: 0, explanation: 'The source says Cedar.' };
const quizPayload = () => ({ title: 'Cedar quiz', difficulty: 'medium', questions: [question, { ...question, id: 'q2', correctAnswer: 1 }] });
const answers = id => ({ attemptId: id, startedAt: '2026-10-12T10:00:00Z', score: 100, results: [{ questionId: 'q1', selectedAnswer: 0, isCorrect: true, timeSpent: 2 }, { questionId: 'q2', selectedAnswer: 0, isCorrect: true, timeSpent: 3 }] });

beforeEach(async () => {
  client = createClient({ url: 'file::memory:' }); db = drizzle(client);
  await client.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id text PRIMARY KEY);
    CREATE TABLE notebooks(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id));
    CREATE TABLE notebook_members(notebook_id text,user_id text);
    INSERT INTO users VALUES ('owner'),('member'),('stranger');
    INSERT INTO notebooks VALUES ('book','owner'),('other','stranger');
    INSERT INTO notebook_members VALUES ('book','member');`);
  await ensureStudioSchema(db);
  repo = createStudioRepository({ getDatabase: async () => db, getNotebookById: async (id, userId) => {
    const result = await client.execute({ sql: 'SELECT id FROM notebooks WHERE id=? AND (user_id=? OR EXISTS (SELECT 1 FROM notebook_members WHERE notebook_id=notebooks.id AND user_id=?))', args: [id, userId, userId] });
    return result.rows[0] ?? null;
  } });
});
afterEach(() => client.close());

describe('private Studio persistence with real SQLite', () => {
  it('bootstraps fresh and existing databases idempotently without dropping records', async () => {
    const deck = await repo.createDeck('book', 'owner', { name: 'Deck', cards: [card] });
    await ensureStudioSchema(db); await ensureStudioSchema(db);
    expect((await repo.getDeck('book', 'owner', deck.id)).cards[0].back).toBe('Cedar');
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'studio_%'");
    expect(tables.rows).toHaveLength(4);
    const indexes = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'studio_%'");
    expect(indexes.rows).toHaveLength(4);
  });
  it('migration supports a baseline database and remains compatible with bootstrap', async () => {
    await client.executeMultiple('DROP TABLE studio_attempts; DROP TABLE studio_quizzes; DROP TABLE studio_decks;');
    const migration = await readFile(new URL('../db/migrations/0002_private_studio.sql', import.meta.url), 'utf8');
    await client.executeMultiple(migration.replaceAll('--> statement-breakpoint', ''));
    const deck = await repo.createDeck('book', 'owner', { name: 'Migrated', cards: [] });
    await ensureStudioSchema(db);
    expect(await repo.getDeck('book', 'owner', deck.id)).toMatchObject({ name: 'Migrated', version: 1 });
  });
  it('isolates personal decks and quizzes even from members of the same notebook', async () => {
    const deck = await repo.createDeck('book', 'owner', { name: 'Private', cards: [card], userId: 'member' });
    const quiz = await repo.createQuiz('book', 'owner', quizPayload());
    expect(deck).not.toHaveProperty('userId');
    expect(await repo.listDecks('book', 'member')).toEqual([]);
    expect(await repo.listQuizzes('book', 'member')).toEqual([]);
    for (const operation of [repo.getDeck('book', 'member', deck.id), repo.updateDeck('book', 'member', deck.id, { expectedVersion: 1, name: 'Stolen' }), repo.deleteDeck('book', 'member', deck.id), repo.getQuiz('book', 'member', quiz.id), repo.completeAttempt('book', 'member', quiz.id, answers(randomUUID())), repo.getDeck('book', 'owner', 'missing'), repo.listDecks('book', 'stranger'), repo.getDeck('other', 'owner', deck.id)]) {
      await expect(operation).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND', message: 'Studio item not found or access denied.' });
    }
    const memberDeck = await repo.createDeck('book', 'member', { name: 'Member deck', cards: [] });
    expect((await repo.listDecks('book', 'owner')).map(item => item.id)).toEqual([deck.id]);
    expect((await repo.listDecks('book', 'member'))[0].id).toBe(memberDeck.id);
  });
  it('CAS preserves a newer review when another client submits a stale version', async () => {
    const deck = await repo.createDeck('book', 'owner', { name: 'Review', cards: [card] });
    const reviewed = await repo.updateDeck('book', 'owner', deck.id, { expectedVersion: 1, cards: [{ ...card, correctCount: 1, lastReviewed: '2026-10-12T10:00:00Z' }] });
    expect(reviewed.version).toBe(2);
    await expect(repo.updateDeck('book', 'owner', deck.id, { expectedVersion: 1, cards: [card] })).rejects.toMatchObject({ code: 'STUDIO_VERSION_CONFLICT', currentVersion: 2 });
    expect((await repo.getDeck('book', 'owner', deck.id)).cards[0].correctCount).toBe(1);
    expect(await repo.deleteDeck('book', 'owner', deck.id)).toEqual({ success: true });
    await expect(repo.getDeck('book', 'owner', deck.id)).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND' });
  });
  it('scores stored immutable questions, ignores client score, and preserves complete history', async () => {
    const payload = quizPayload(), quiz = await repo.createQuiz('book', 'owner', payload);
    payload.questions[0] = { ...question, correctAnswer: 1 };
    expect((await repo.getQuiz('book', 'owner', quiz.id)).questions[0].correctAnswer).toBe(0);
    const submission = answers(randomUUID()), attempt = await repo.completeAttempt('book', 'owner', quiz.id, submission);
    expect(attempt).toMatchObject({ score: 50, totalQuestions: 2, title: 'Cedar quiz', quizId: quiz.id });
    expect(attempt.results[1]).toMatchObject({ isCorrect: false, correctAnswer: 1, explanation: question.explanation });
    expect(await repo.completeAttempt('book', 'owner', quiz.id, submission)).toEqual(attempt);
    expect(await repo.listAttempts('book', 'owner')).toHaveLength(1);
    await expect(repo.completeAttempt('book', 'owner', quiz.id, { ...submission, results: submission.results.map(r => ({ ...r, selectedAnswer: 1 })) })).rejects.toMatchObject({ code: 'STUDIO_ATTEMPT_CONFLICT' });
    const retry = await repo.completeAttempt('book', 'owner', quiz.id, { ...submission, attemptId: randomUUID() });
    expect(retry.id).not.toBe(attempt.id);
    expect(await repo.listAttempts('book', 'owner')).toHaveLength(2);
    expect(await repo.listAttempts('book', 'member')).toEqual([]);
  });
  it('does not expose attempt ID collisions belonging to another account', async () => {
    const first = await repo.createQuiz('book', 'owner', quizPayload());
    const second = await repo.createQuiz('book', 'member', quizPayload());
    const submission = answers(randomUUID());
    await repo.completeAttempt('book', 'owner', first.id, submission);
    await expect(repo.completeAttempt('book', 'member', second.id, submission)).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND' });
  });
  it('validates byte budgets, counts, duplicate IDs, card reviews, and complete answer sets', async () => {
    for (const payload of [null, {}, { name: 'Deck', cards: Array(1001).fill(card) }, { name: 'Deck', cards: [card, card] }, { name: 'Deck', cards: [{ ...card, correctCount: -1 }] }, { name: 'Deck', cards: [], padding: '🌲'.repeat(250001) }]) {
      await expect(repo.createDeck('book', 'owner', payload)).rejects.toMatchObject({ code: 'STUDIO_INVALID_PAYLOAD' });
    }
    for (const payload of [{ ...quizPayload(), questions: [] }, { ...quizPayload(), questions: [question, question] }, { ...quizPayload(), questions: [{ ...question, correctAnswer: 2 }] }, { ...quizPayload(), questions: [{ ...question, options: ['Only one'] }] }]) {
      await expect(repo.createQuiz('book', 'owner', payload)).rejects.toMatchObject({ code: 'STUDIO_INVALID_PAYLOAD' });
    }
    const quiz = await repo.createQuiz('book', 'owner', quizPayload());
    for (const results of [[], [{ questionId: 'q1', selectedAnswer: 0 }, { questionId: 'q1', selectedAnswer: 1 }], [{ questionId: 'q1', selectedAnswer: 0 }, { questionId: 'unknown', selectedAnswer: 0 }], [{ questionId: 'q1', selectedAnswer: 100 }, { questionId: 'q2', selectedAnswer: 0 }]]) {
      await expect(repo.completeAttempt('book', 'owner', quiz.id, { attemptId: randomUUID(), results })).rejects.toMatchObject({ code: 'STUDIO_INVALID_PAYLOAD' });
    }
    expect(await repo.listAttempts('book', 'owner')).toEqual([]);
  });
  it('cascades owned Studio data when the notebook is removed', async () => {
    await repo.createDeck('book', 'owner', { name: 'Deck', cards: [] });
    const quiz = await repo.createQuiz('book', 'owner', quizPayload());
    await repo.completeAttempt('book', 'owner', quiz.id, answers(randomUUID()));
    await client.execute("DELETE FROM notebooks WHERE id='book'");
    for (const table of ['studio_decks', 'studio_quizzes', 'studio_attempts']) {
      expect((await client.execute(`SELECT count(*) AS count FROM ${table}`)).rows[0].count).toBe(0);
    }
  });
});


describe('true/false persistence boundary', () => {
  const tf = { id: 'tf1', type: 'true_false', question: 'Cedar uses seventeen blue trays.', options: ['True', 'False'], correctAnswer: 0, explanation: 'The source specifies seventeen trays.' };
  it('roundtrips valid statements and keeps the quiz private', async () => {
    const quiz = await repo.createQuiz('book', 'owner', { ...quizPayload(), questions: [tf, { ...tf, id: 'tf2', question: 'Cedar uses twenty trays.', correctAnswer: 1 }] });
    expect((await repo.getQuiz('book', 'owner', quiz.id)).questions).toMatchObject([tf, { id: 'tf2', correctAnswer: 1 }]);
    await expect(repo.getQuiz('book', 'member', quiz.id)).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND' });
    await expect(repo.getQuiz('book', 'stranger', quiz.id)).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND' });
  });
  it.each([
    { question: 'According to the text, how many blue trays are used in the Cedar experiment?' },
    { question: 'How many blue trays are used' },
    { question: 'Are seventeen blue trays used' },
    { question: 'Cedar uses seventeen trays?' },
    { options: ['False', 'True'] },
    { options: ['Yes', 'No'] },
    { options: ['true', 'false'] },
  ])('rejects malformed TF atomically: %j', async invalidQuestion => {
    await expect(repo.createQuiz('book', 'owner', { ...quizPayload(), questions: [tf, { ...tf, id: 'tf2', ...invalidQuestion }] })).rejects.toMatchObject({ code: 'STUDIO_INVALID_PAYLOAD' });
    expect(await repo.listQuizzes('book', 'owner')).toEqual([]);
  });
});
