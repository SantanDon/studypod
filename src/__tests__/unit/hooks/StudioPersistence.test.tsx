import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '@/contexts/AuthContextInstance';
import { useQuiz } from '@/hooks/useQuiz';
import { useFlashcards } from '@/hooks/useFlashcards';
import type { Quiz, QuizHistory } from '@/types/quiz';
import type { FlashcardDeck } from '@/types/flashcard';

const generators = vi.hoisted(() => ({ quiz: vi.fn(), cards: vi.fn() }));
vi.mock('@/lib/quiz/quizGenerator', () => ({ generateQuiz: generators.quiz, calculateScore: (results: { isCorrect: boolean }[]) => results.filter(r => r.isCorrect).length / results.length * 100 }));
vi.mock('@/lib/flashcards/flashcardGenerator', () => ({ generateFlashcards: generators.cards }));
const quiz: Quiz = { id: 'quiz-server', notebookId: 'book', title: 'Cedar', createdAt: '2026-10-12', difficulty: 'easy', questions: [{ id: 'q1', question: 'How many trays?', options: ['17', '20'], correctAnswer: 0, explanation: '17 trays', sourceId: 'source', difficulty: 'easy', type: 'multiple_choice' }] };
const deck: FlashcardDeck = { id: 'deck-a', notebookId: 'book', name: 'Cedar', version: 1, createdAt: '2026-10-12', updatedAt: '2026-10-12', cards: [{ id: 'card', front: 'Trays?', back: '17', sourceId: 'source', sourceTitle: 'Cedar', cardType: 'fact', difficulty: 'easy', lastReviewed: null, nextReview: null, correctCount: 0, incorrectCount: 0, easeFactor: 2.5, interval: 0 }] };
const account = (id: string | null) => ({ user: id ? { id } : null, session: id ? { access_token: 'SESSION_MANAGED_BY_COOKIE' } : null, loading: false, error: null, isAuthenticated: !!id }) as AuthContextType;
let auth = account('a');
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn>;
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AuthContext.Provider value={auth}>{children}</AuthContext.Provider></QueryClientProvider>;
beforeEach(() => {
  auth = account('a'); localStorage.clear(); localStorage.setItem('guest_id', 'guest-one');
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  generators.quiz.mockReset(); generators.cards.mockReset();
  fetcher = vi.fn((url: string) => reply(url.endsWith('/decks') ? { decks: [deck] } : url.endsWith('/quizzes') ? { quizzes: [quiz] } : { attempts: [] }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('hydrates owned decks and separates account caches without importing unowned storage', async () => {
  localStorage.setItem('flashcard_decks', JSON.stringify([{ ...deck, id: 'unowned' }]));
  const { result, rerender } = renderHook(() => useFlashcards('book'), { wrapper });
  await waitFor(() => expect(result.current.decks[0]?.id).toBe('deck-a'));
  auth = account('b'); fetcher.mockImplementation(() => reply({ decks: [{ ...deck, id: 'deck-b' }] })); rerender();
  expect(result.current.decks).toEqual([]);
  await waitFor(() => expect(result.current.decks[0]?.id).toBe('deck-b'));
  expect(client.getQueryData(['flashcard-decks', 'account:a', 'book'])).toEqual([deck]);
  expect(localStorage.getItem('flashcard_decks')).toContain('unowned');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
});

it('rejects deck version conflicts without applying review or falling back locally', async () => {
  const { result } = renderHook(() => useFlashcards('book'), { wrapper });
  await waitFor(() => expect(result.current.decks).toHaveLength(1));
  fetcher.mockImplementation((_url, options) => options?.method === 'PUT' ? reply({ error: 'Reload this deck', code: 'STUDIO_VERSION_CONFLICT', currentVersion: 2 }, 409) : reply({ decks: [deck] }));
  await act(async () => { await expect(result.current.reviewCardAsync({ deckId: deck.id, cardId: 'card', quality: 5 })).rejects.toThrow('Reload this deck'); });
  expect(result.current.decks[0].cards[0].correctCount).toBe(0);
  await waitFor(() => expect(result.current.mutationError).toBe('Reload this deck'));
  const put = fetcher.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(put[1].body).expectedVersion).toBe(1);
  expect(Object.keys(localStorage)).toEqual(['guest_id']);
});

it('stores guest decks in a guest-qualified namespace and preserves legacy unowned data', async () => {
  auth = account(null); localStorage.setItem('flashcard_decks', '[{"id":"legacy"}]');
  const { result } = renderHook(() => useFlashcards('book'), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await result.current.createDeckAsync({ name: 'Guest deck', notebookId: 'book' }); });
  expect(JSON.parse(localStorage.getItem('studypod:studio:guest:guest-one:decks')!)[0].name).toBe('Guest deck');
  expect(localStorage.getItem('flashcard_decks')).toBe('[{"id":"legacy"}]'); expect(fetcher).not.toHaveBeenCalled();
});

it('does not start generated quizzes when authenticated persistence fails', async () => {
  generators.quiz.mockResolvedValue(quiz);
  fetcher.mockImplementation((_url, options) => options?.method === 'POST' ? reply({ error: 'Save unavailable' }, 503) : reply(_url.endsWith('/quizzes') ? { quizzes: [] } : { attempts: [] }));
  const { result } = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  await act(async () => { await expect(result.current.generateQuizAsync({ sources: [], numQuestions: 1, difficulty: 'easy' })).rejects.toThrow('Save unavailable'); });
  expect(result.current.currentSession).toBeNull(); expect(result.current.generationError).toBe('Save unavailable');
  expect(localStorage.getItem('quizzes')).toBeNull(); expect(localStorage.getItem('studypod:studio:guest:guest-one:quizzes')).toBeNull();
});

it('requires confirmed scoring, retains retry payload, hydrates detailed history, and gives a fresh retry identity', async () => {
  let attempts: QuizHistory[] = []; const save = deferred<Response>(); let submissions = 0;
  fetcher.mockImplementation((url, options) => {
    if (options?.method === 'POST') { submissions++; return submissions === 1 ? reply({ error: 'Temporary save failure' }, 503) : save.promise; }
    return reply(url.endsWith('/quizzes') ? { quizzes: [quiz] } : { attempts });
  });
  const { result, unmount } = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  await waitFor(() => expect(result.current.savedQuizzes).toHaveLength(1));
  act(() => result.current.openQuiz(quiz)); act(() => result.current.answerQuestion(0, 3));
  const attemptId = result.current.currentSession!.attemptId;
  await act(async () => { expect(await result.current.completeQuiz()).toBeNull(); });
  expect(result.current.currentSession!.isComplete).toBe(false); expect(result.current.completionError).toBe('Temporary save failure');
  let completion!: ReturnType<typeof result.current.completeQuiz>;
  act(() => { completion = result.current.completeQuiz(); });
  expect(result.current.isCompleting).toBe(true); expect(result.current.currentSession!.isComplete).toBe(false);
  const bodies = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options.body));
  expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0].results).toEqual([{ questionId: 'q1', selectedAnswer: 0, timeSpent: 3 }]);
  const attempt: QuizHistory = { id: attemptId, quizId: quiz.id, notebookId: 'book', title: quiz.title, difficulty: 'easy', score: 0, totalQuestions: 1, completedAt: new Date().toISOString(), results: [{ questionId: 'q1', selectedAnswer: 0, timeSpent: 3, isCorrect: false, correctAnswer: 1, explanation: 'Server-owned explanation' }] };
  attempts = [attempt];
  await act(async () => { save.resolve(await reply({ attempt })); expect((await completion)?.score).toBe(0); });
  expect(result.current.currentSession!.results[0].explanation).toBe('Server-owned explanation');
  act(() => result.current.retryQuiz()); expect(result.current.currentSession!.attemptId).not.toBe(attemptId);
  unmount(); const reloaded = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  await waitFor(() => expect(reloaded.result.current.quizHistory).toEqual([attempt]));
  act(() => { expect(reloaded.result.current.reopenAttempt(attempt)).toBe(true); });
  expect(reloaded.result.current.currentSession!.isComplete).toBe(true); expect(reloaded.result.current.currentSession!.results).toEqual(attempt.results);
});

it('ignores pending completion after switching away and back to the same account', async () => {
  const save = deferred<Response>(); fetcher.mockImplementation((url, options) => options?.method === 'POST' ? save.promise : reply(url.endsWith('/quizzes') ? { quizzes: [quiz] } : { attempts: [] }));
  const { result, rerender } = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  act(() => result.current.openQuiz(quiz)); act(() => result.current.answerQuestion(0, 2));
  let completion!: ReturnType<typeof result.current.completeQuiz>; act(() => { completion = result.current.completeQuiz(); });
  auth = account('b'); rerender(); expect(result.current.currentSession).toBeNull();
  auth = account('a'); rerender();
  await act(async () => { save.resolve(await reply({ attempt: { score: 100, results: [] } })); expect(await completion).toBeNull(); });
  expect(result.current.currentSession).toBeNull(); expect(result.current.completionError).toBeNull();
});

it('rejects a pending generated quiz after account changes before any persistence request', async () => {
  const generated = deferred<Quiz>(); generators.quiz.mockReturnValue(generated.promise);
  const { result, rerender } = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  let outcome!: Promise<unknown>; act(() => { outcome = result.current.generateQuizAsync({ sources: [], numQuestions: 1, difficulty: 'easy' }).catch(error => error); });
  await waitFor(() => expect(generators.quiz).toHaveBeenCalled()); auth = account('b'); rerender();
  await act(async () => { generated.resolve(quiz); expect(await outcome).toBeInstanceOf(Error); });
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0); expect(result.current.currentSession).toBeNull();
});

it('does not apply an old attempt answer callback to a newly opened attempt', async () => {
  fetcher.mockImplementation(url => reply(url.endsWith('/quizzes') ? { quizzes: [quiz] } : { attempts: [] }));
  const { result } = renderHook(() => useQuiz({ notebookId: 'book' }), { wrapper });
  act(() => result.current.openQuiz(quiz));
  const oldAnswer = result.current.answerQuestion;
  const oldAttemptId = result.current.currentSession!.attemptId;
  act(() => result.current.openQuiz(quiz));
  expect(result.current.currentSession!.attemptId).not.toBe(oldAttemptId);
  act(() => oldAnswer(0, 2));
  expect(result.current.currentSession!.results).toEqual([]);
});
