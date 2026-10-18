import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { studioDecks, studioQuizzes, studioAttempts, studioMaps } from '../db/studioSchema.js';

export const studioLimits = { maxBytes: 1_000_000, maxCards: 1000, maxQuestions: 100 };
function fail(code, message, extra = {}) { throw Object.assign(new Error(message), { code, ...extra }); }
function invalid(message) { fail('STUDIO_INVALID_PAYLOAD', message); }
function text(value, label, max = 10000, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) invalid(`${label} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters.`);
  return value;
}
function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(`${label} is out of range.`);
  return value;
}
function choice(value, label, choices) { if (!choices.includes(value)) invalid(`${label} is invalid.`); return value; }
function date(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) invalid(`${label} must be a valid date.`);
  return new Date(value).toISOString();
}
function bounded(value) {
  if (!value || typeof value !== 'object') invalid('Studio payload must be an object.');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > studioLimits.maxBytes) invalid('Studio payload exceeds the 1 MB limit.');
  return value;
}
function items(values, label, max, normalize, allowEmpty = false) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > max) invalid(`${label} must contain ${allowEmpty ? '0' : '1'} to ${max} items.`);
  bounded(values);
  const result = values.map(normalize);
  if (new Set(result.map(item => item.id)).size !== result.length) invalid(`${label} IDs must be unique.`);
  return result;
}
function cards(values) {
  return items(values, 'Cards', studioLimits.maxCards, card => {
    if (!card || typeof card !== 'object') invalid('Invalid card.');
    return {
      id: text(card.id, 'Card ID', 100), front: text(card.front, 'Card front'), back: text(card.back, 'Card back'),
      sourceId: text(card.sourceId ?? '', 'Source ID', 100, true), sourceTitle: text(card.sourceTitle ?? '', 'Source title', 500, true),
      cardType: choice(card.cardType ?? 'fact', 'Card type', ['definition', 'concept', 'fact']),
      difficulty: choice(card.difficulty ?? 'medium', 'Difficulty', ['easy', 'medium', 'hard']),
      lastReviewed: date(card.lastReviewed, 'Last review', true), nextReview: date(card.nextReview, 'Next review', true),
      correctCount: number(card.correctCount ?? 0, 'Correct count', 0, 1_000_000, true),
      incorrectCount: number(card.incorrectCount ?? 0, 'Incorrect count', 0, 1_000_000, true),
      easeFactor: number(card.easeFactor ?? 2.5, 'Ease factor', 1, 100), interval: number(card.interval ?? 0, 'Interval', 0, 1_000_000),
    };
  }, true);
}
// This validates statement shape, not source grounding or the generated truth label.
function isDeclarativeStatement(statement) {
  if (/[?\uFF1F]/u.test(statement)) return false;
  const claim = statement.trim().replace(/^according to (?:the )?(?:text|source|content|passage|document|study)\s*,?\s+/i, '');
  return !/^(?:what|which|how|why|when|where|who|whom|whose|is|are|was|were|am|do|does|did|can|could|will|would|should|has|have|had|may|might|must)\b/i.test(claim);
}
function questions(values) {
  return items(values, 'Questions', studioLimits.maxQuestions, question => {
    if (!question || typeof question !== 'object') invalid('Invalid question.');
    const type = choice(question.type ?? 'multiple_choice', 'Question type', ['multiple_choice', 'true_false']);
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10 || (type === 'true_false' && question.options.length !== 2)) invalid('Questions require 2 to 10 options (true/false requires 2).');
    const statement = text(question.question, 'Question');
    if (type === 'true_false' && (question.options[0] !== 'True' || question.options[1] !== 'False' || !isDeclarativeStatement(statement))) {
      invalid('True/false requires a declarative statement and ordered True/False options.');
    }
    return {
      id: text(question.id, 'Question ID', 100), question: statement,
      options: question.options.map(option => text(option, 'Option', 2000)),
      correctAnswer: number(question.correctAnswer, 'Correct answer', 0, question.options.length - 1, true),
      explanation: text(question.explanation ?? '', 'Explanation', 10000, true),
      sourceId: text(question.sourceId ?? '', 'Source ID', 100, true), difficulty: choice(question.difficulty ?? 'medium', 'Difficulty', ['easy', 'medium', 'hard']), type,
    };
  });
}
function normalize(row, field) {
  if (!row) return null;
  const { userId: _owner, ...publicRow } = row;
  for (const name of Array.isArray(field) ? field : field ? [field] : []) publicRow[name] = JSON.parse(row[name]);
  return publicRow;
}
function graph(payload) {
  const nodes = items(payload.nodes, 'Nodes', 500, node => {
    if (!node || typeof node !== 'object') invalid('Invalid map node.');
    return { id: text(node.id, 'Node ID', 100), label: text(node.label, 'Node label', 1000),
      type: choice(node.type, 'Node type', ['main', 'subtopic', 'detail', 'term']),
      ...(node.description === undefined ? {} : { description: text(node.description, 'Description', 10000, true) }),
      ...(node.sourceId === undefined ? {} : { sourceId: text(node.sourceId, 'Source ID', 100) }),
      ...(node.x === undefined ? {} : { x: number(node.x, 'Node x', -1e6, 1e6) }),
      ...(node.y === undefined ? {} : { y: number(node.y, 'Node y', -1e6, 1e6) }) };
  });
  const ids = new Set(nodes.map(node => node.id));
  const edges = items(payload.edges, 'Edges', 2000, edge => {
    if (!edge || typeof edge !== 'object') invalid('Invalid map edge.');
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) invalid('Map edges must connect two stored nodes.');
    return { id: text(edge.id, 'Edge ID', 100), source: edge.source, target: edge.target,
      type: choice(edge.type, 'Edge type', ['related', 'explains', 'example', 'part_of']),
      ...(edge.label === undefined ? {} : { label: text(edge.label, 'Edge label', 1000, true) }) };
  }, true);
  return { nodes, edges };
}
const unavailable = () => fail('STUDIO_NOT_FOUND', 'Studio item not found or access denied.');

// Dependency injection permits real SQLite tests without touching the application's database.
export function createStudioRepository({ getDatabase, getNotebookById }) {
  async function access(notebookId, userId) {
    if (!userId || !notebookId || !await getNotebookById(notebookId, userId)) unavailable();
  }
  const owned = (table, notebookId, userId, id) => and(eq(table.notebookId, notebookId), eq(table.userId, userId), ...(id ? [eq(table.id, id)] : []));
  async function read(table, notebookId, userId, id, field) {
    await access(notebookId, userId);
    const db = await getDatabase();
    const rows = await db.select().from(table).where(owned(table, notebookId, userId, id)).limit(1);
    if (!rows[0]) unavailable();
    return normalize(rows[0], field);
  }
  async function list(table, notebookId, userId, field, order) {
    await access(notebookId, userId);
    const db = await getDatabase();
    return (await db.select().from(table).where(owned(table, notebookId, userId)).orderBy(desc(order))).map(row => normalize(row, field));
  }
  const getDeck = (notebookId, userId, id) => read(studioDecks, notebookId, userId, id, 'cards');
  const getQuiz = (notebookId, userId, id) => read(studioQuizzes, notebookId, userId, id, 'questions');
  const getMap = (notebookId, userId, id) => read(studioMaps, notebookId, userId, id, ['nodes', 'edges']);
  async function createMap(notebookId, userId, payload) {
    await access(notebookId, userId); bounded(payload);
    const title = text(payload.title, 'Map title', 240), clean = graph(payload);
    const id = randomUUID(), now = new Date().toISOString(), db = await getDatabase();
    await db.insert(studioMaps).values({ id, notebookId, userId, title, nodes: JSON.stringify(clean.nodes), edges: JSON.stringify(clean.edges), createdAt: now, updatedAt: now });
    return getMap(notebookId, userId, id);
  }
  async function deleteMap(notebookId, userId, id) {
    await getMap(notebookId, userId, id);
    const db = await getDatabase();
    const result = await db.delete(studioMaps).where(owned(studioMaps, notebookId, userId, id));
    return { success: !!result.rowsAffected };
  }
  async function createDeck(notebookId, userId, payload) {
    await access(notebookId, userId); bounded(payload);
    const name = text(payload.name, 'Deck name', 240); const cleanCards = cards(payload.cards ?? []);
    const id = randomUUID(), now = new Date().toISOString(), db = await getDatabase();
    await db.insert(studioDecks).values({ id, notebookId, userId, name, cards: JSON.stringify(cleanCards), version: 1, createdAt: now, updatedAt: now });
    return getDeck(notebookId, userId, id);
  }
  async function updateDeck(notebookId, userId, id, payload) {
    const existing = await getDeck(notebookId, userId, id); bounded(payload);
    const expectedVersion = number(payload.expectedVersion, 'Expected version', 1, Number.MAX_SAFE_INTEGER, true);
    const name = payload.name === undefined ? existing.name : text(payload.name, 'Deck name', 240);
    const cleanCards = payload.cards === undefined ? existing.cards : cards(payload.cards);
    const db = await getDatabase();
    const result = await db.update(studioDecks).set({ name, cards: JSON.stringify(cleanCards), version: expectedVersion + 1, updatedAt: new Date().toISOString() })
      .where(and(owned(studioDecks, notebookId, userId, id), eq(studioDecks.version, expectedVersion)));
    if (!result.rowsAffected) {
      const current = await getDeck(notebookId, userId, id);
      fail('STUDIO_VERSION_CONFLICT', 'Deck changed. Reload before saving your review.', { currentVersion: current.version });
    }
    return getDeck(notebookId, userId, id);
  }
  async function deleteDeck(notebookId, userId, id) {
    await getDeck(notebookId, userId, id);
    const db = await getDatabase();
    const result = await db.delete(studioDecks).where(owned(studioDecks, notebookId, userId, id));
    return { success: !!result.rowsAffected };
  }
  async function createQuiz(notebookId, userId, payload) {
    await access(notebookId, userId); bounded(payload);
    const title = text(payload.title, 'Quiz title', 240), difficulty = choice(payload.difficulty, 'Difficulty', ['easy', 'medium', 'hard']);
    const cleanQuestions = questions(payload.questions), id = randomUUID(), db = await getDatabase();
    await db.insert(studioQuizzes).values({ id, notebookId, userId, title, difficulty, questions: JSON.stringify(cleanQuestions), createdAt: new Date().toISOString() });
    return getQuiz(notebookId, userId, id);
  }
  async function listAttempts(notebookId, userId) {
    const rows = await list(studioAttempts, notebookId, userId, 'results', studioAttempts.completedAt);
    const quizzes = await list(studioQuizzes, notebookId, userId, 'questions', studioQuizzes.createdAt);
    const map = new Map(quizzes.map(quiz => [quiz.id, quiz]));
    return rows.map(row => ({ ...row, title: map.get(row.quizId)?.title, difficulty: map.get(row.quizId)?.difficulty }));
  }
  async function completeAttempt(notebookId, userId, quizId, payload) {
    const quiz = await getQuiz(notebookId, userId, quizId); bounded(payload);
    const id = text(payload.attemptId, 'Attempt ID', 100);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(id)) invalid('Attempt ID must be a unique identifier of 16 to 100 characters.');
    if (!Array.isArray(payload.results) || payload.results.length !== quiz.questions.length) invalid('Answer every question exactly once before completing the quiz.');
    const answers = new Map();
    for (const answer of payload.results) {
      if (!answer || typeof answer.questionId !== 'string' || answers.has(answer.questionId)) invalid('Question answers must be unique.');
      answers.set(answer.questionId, answer);
    }
    const results = quiz.questions.map(question => {
      const answer = answers.get(question.id); if (!answer) invalid('Every stored quiz question requires an answer.');
      const selectedAnswer = number(answer.selectedAnswer, 'Selected answer', 0, question.options.length - 1, true);
      return { questionId: question.id, selectedAnswer, timeSpent: number(answer.timeSpent ?? 0, 'Time spent', 0, 86400), isCorrect: selectedAnswer === question.correctAnswer, correctAnswer: question.correctAnswer, explanation: question.explanation };
    });
    const startedAt = date(payload.startedAt, 'Started at', true);
    const db = await getDatabase();
    // Insert-if-absent makes simultaneous retries idempotent without trusting client scoring.
    await db.insert(studioAttempts).values({ id, notebookId, userId, quizId, results: JSON.stringify(results), score: Math.round(results.filter(r => r.isCorrect).length / results.length * 100), totalQuestions: results.length, startedAt, completedAt: new Date().toISOString() }).onConflictDoNothing();
    const row = (await db.select().from(studioAttempts).where(owned(studioAttempts, notebookId, userId, id)).limit(1))[0];
    if (!row || row.quizId !== quizId) unavailable();
    if (row.results !== JSON.stringify(results) || row.startedAt !== startedAt) fail('STUDIO_ATTEMPT_CONFLICT', 'This attempt was already completed with different answers. Start a new attempt to retry.');
    return { ...normalize(row, 'results'), title: quiz.title, difficulty: quiz.difficulty };
  }
  return { getMap, createMap, deleteMap, getDeck, createDeck, updateDeck, deleteDeck, getQuiz, createQuiz, completeAttempt, listAttempts,
    listMaps: (notebookId, userId) => list(studioMaps, notebookId, userId, ['nodes', 'edges'], studioMaps.updatedAt),
    listDecks: (notebookId, userId) => list(studioDecks, notebookId, userId, 'cards', studioDecks.updatedAt),
    listQuizzes: (notebookId, userId) => list(studioQuizzes, notebookId, userId, 'questions', studioQuizzes.createdAt) };
}

export const studioRepository = createStudioRepository({
  getDatabase: async () => (await import('../db/database.js')).getDatabase(),
  getNotebookById: async (id, userId) => (await import('../db/database.js')).dbHelpers.getNotebookById(id, userId),
});
