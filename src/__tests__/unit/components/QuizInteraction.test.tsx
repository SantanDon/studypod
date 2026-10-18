import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useQuiz } from '@/hooks/useQuiz';
import QuizView from '@/components/notebook/QuizView';
import type { Quiz } from '@/types/quiz';
import { AuthContext, type AuthContextType } from '@/contexts/AuthContextInstance';

const guest = { user: null, session: null, loading: false, error: null, isAuthenticated: false } as AuthContextType;

const quiz: Quiz = {
  id: 'quiz-feedback', notebookId: 'owned-notebook', title: 'Cedar quiz',
  createdAt: '2026-10-12', difficulty: 'easy',
  questions: [1, 2, 3].map(number => ({
    id: `question-${number}`, question: `Cedar question ${number}`,
    options: ['Seventeen', 'Twenty'], correctAnswer: 0,
    explanation: `Explanation for question ${number}: seventeen trays.`,
    sourceId: 'cedar', difficulty: 'easy', type: 'multiple_choice',
  })),
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthContext.Provider value={guest}>{children}</AuthContext.Provider>
  </QueryClientProvider>
);
afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Learner() {
  const flow = useQuiz({ notebookId: quiz.notebookId });
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => { flow.startQuiz(quiz); }, [flow.startQuiz]);
  if (score !== null && flow.currentSession?.isComplete) return <div>Final score: {score}</div>;
  const question = flow.getCurrentQuestion();
  if (!question) return null;
  const progress = flow.getProgress();
  return <QuizView question={question} questionNumber={progress.current} totalQuestions={progress.total}
    onAnswer={flow.answerQuestion} onNext={flow.nextQuestion}
    onComplete={async () => { const completed = await flow.completeQuiz(); if (completed) setScore(completed.score); }}
    isLastQuestion={progress.current === progress.total} />;
}

it('keeps feedback visible, visits every question once, and saves the full score after See Results', async () => {
  render(<Learner />, { wrapper });
  for (const number of [1, 2, 3]) {
    expect(screen.getByRole('heading', { name: `Cedar question ${number}` })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Seventeen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
    expect(screen.getByText(`Explanation for question ${number}: seventeen trays.`)).toBeVisible();
    expect(screen.getByRole('heading', { name: `Cedar question ${number}` })).toBeVisible();
    expect(screen.queryByText('Final score: 100')).not.toBeInTheDocument();
    const nextLabel = number === 3 ? 'See Results' : 'Next Question';
    const next = screen.getByRole('button', { name: nextLabel, exact: true });
    expect(next).toHaveAttribute('aria-label', nextLabel);
    expect(next.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(next);
  }
  await waitFor(() => expect(screen.getByText('Final score: 100')).toBeVisible());
  expect(JSON.parse(localStorage.getItem(`studypod:studio:guest:${localStorage.getItem('guest_id')}:attempts`)!)).toEqual([
    expect.objectContaining({ notebookId: quiz.notebookId, score: 100, totalQuestions: 3 }),
  ]);
});

it('cannot skip an unanswered question or record a double submission', () => {
  const { result } = renderHook(() => useQuiz(), { wrapper });
  act(() => result.current.startQuiz(quiz));
  act(() => result.current.nextQuestion());
  expect(result.current.currentSession!.currentQuestionIndex).toBe(0);
  act(() => {
    result.current.answerQuestion(1, 4);
    result.current.answerQuestion(1, 4);
  });
  expect(result.current.currentSession!.results).toHaveLength(1);
  expect(result.current.currentSession!.results[0].isCorrect).toBe(false);
  expect(result.current.currentSession!.isComplete).toBe(false);
  act(() => result.current.nextQuestion());
  expect(result.current.getCurrentQuestion()!.id).toBe('question-2');
});

it('only marks the session complete after every answer, so Studio can display results', async () => {
  const { result } = renderHook(() => useQuiz(), { wrapper });
  act(() => result.current.startQuiz(quiz));
  await act(async () => { await result.current.completeQuiz(); });
  expect(result.current.currentSession!.isComplete).toBe(false);
  expect(result.current.quizHistory).toHaveLength(0);
  for (let index = 0; index < quiz.questions.length; index++) {
    act(() => { result.current.answerQuestion(0, 4); });
    expect(result.current.currentSession!.isComplete).toBe(false);
    if (index < quiz.questions.length - 1) act(() => result.current.nextQuestion());
  }
  await act(async () => { await result.current.completeQuiz(); });
  expect(result.current.currentSession!.isComplete).toBe(true);
  expect(result.current.currentSession!.results).toHaveLength(3);
});
