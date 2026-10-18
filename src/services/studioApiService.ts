import { useCallback, useContext, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GuestContext } from '@/contexts/GuestContextInstance';
import { API_BASE_URL } from '@/config/api';
import type { FlashcardDeck } from '@/types/flashcard';
import type { Quiz, QuizHistory, QuizResult } from '@/types/quiz';
import type { ConceptMap } from '@/types/conceptMap';

export class StudioApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export function useStudioIdentity(notebookId?: string) {
  const auth = useAuth();
  const guest = useContext(GuestContext);
  let guestId = guest?.guestId || localStorage.getItem('guest_id');
  if (!auth.loading && !auth.user && !guestId) {
    guestId = crypto.randomUUID();
    localStorage.setItem('guest_id', guestId);
  }
  const owner = auth.loading ? 'pending' : auth.user ? `account:${auth.user.id}` : `guest:${guestId}`;
  const key = `${owner}:${notebookId || '*'}`;
  const active = useRef({ key, epoch: 0 });
  if (active.current.key !== key) active.current = { key, epoch: active.current.epoch + 1 };
  const epoch = active.current.epoch;
  const assertCurrent = useCallback(() => {
    if (active.current.key !== key || active.current.epoch !== epoch || auth.loading) {
      throw new Error('Your account or notebook changed. Please try again in the current notebook.');
    }
  }, [key, epoch, auth.loading]);
  return { owner, key, ready: !auth.loading, authenticated: !!auth.user,
    token: auth.session?.access_token, assertCurrent };
}

export function readGuestStudio<T>(owner: string, kind: string): T[] {
  const raw = localStorage.getItem(`studypod:studio:${owner}:${kind}`);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved guest Studio data is unreadable.');
  return parsed;
}
export function writeGuestStudio<T>(owner: string, kind: string, values: T[]) {
  localStorage.setItem(`studypod:studio:${owner}:${kind}`, JSON.stringify(values));
}

export function studioApi(token?: string) {
  async function request<T>(notebookId: string, path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!notebookId) throw new Error('Choose a notebook before saving Studio work.');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token && !['COOKIE_SESSION', 'SESSION_MANAGED_BY_COOKIE', 'managed_by_cookie'].includes(token)) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}/notebooks/${encodeURIComponent(notebookId)}/studio${path}`, {
      method, credentials: 'include', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event('auth:unauthorized'));
      throw new StudioApiError(data.error || data.message || `Studio save failed (${response.status}). Please retry.`, response.status, data.code);
    }
    return data as T;
  }
  return {
    maps: async (id: string) => (await request<{ maps: ConceptMap[] }>(id, '/maps')).maps,
    createMap: async (map: ConceptMap) => (await request<{ map: ConceptMap }>(map.notebookId, '/maps', 'POST', { title: map.title, nodes: map.nodes, edges: map.edges })).map,
    deleteMap: (map: ConceptMap) => request(map.notebookId, `/maps/${encodeURIComponent(map.id)}`, 'DELETE'),
    decks: async (id: string) => (await request<{ decks: FlashcardDeck[] }>(id, '/decks')).decks,
    createDeck: async (id: string, name: string) => (await request<{ deck: FlashcardDeck }>(id, '/decks', 'POST', { name, cards: [] })).deck,
    updateDeck: async (deck: FlashcardDeck, cards: FlashcardDeck['cards']) => {
      if (deck.version === undefined) throw new Error('Reload this deck before saving changes.');
      return (await request<{ deck: FlashcardDeck }>(deck.notebookId, `/decks/${encodeURIComponent(deck.id)}`, 'PUT', { expectedVersion: deck.version, cards })).deck;
    },
    deleteDeck: (deck: FlashcardDeck) => request(deck.notebookId, `/decks/${encodeURIComponent(deck.id)}`, 'DELETE'),
    quizzes: async (id: string) => (await request<{ quizzes: Quiz[] }>(id, '/quizzes')).quizzes,
    createQuiz: async (quiz: Quiz) => (await request<{ quiz: Quiz }>(quiz.notebookId, '/quizzes', 'POST', { title: quiz.title, difficulty: quiz.difficulty, questions: quiz.questions })).quiz,
    attempts: async (id: string) => (await request<{ attempts: QuizHistory[] }>(id, '/attempts')).attempts,
    complete: async (quiz: Quiz, attemptId: string, results: QuizResult[], startedAt: string) => (await request<{ attempt: QuizHistory }>(quiz.notebookId, `/quizzes/${encodeURIComponent(quiz.id)}/attempts`, 'POST', {
      attemptId, startedAt, results: results.map(({ questionId, selectedAnswer, timeSpent }) => ({ questionId, selectedAnswer, timeSpent })),
    })).attempt,
  };
}
