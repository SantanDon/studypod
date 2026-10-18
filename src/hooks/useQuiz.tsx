import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LocalSource } from '@/services/localStorageService';
import { Quiz, QuizResult, QuizSession, QuizHistory, QuestionDifficulty, QuestionType } from '@/types/quiz';
import { generateQuiz, calculateScore } from '@/lib/quiz/quizGenerator';
import { useStudioIdentity, studioApi, readGuestStudio, writeGuestStudio } from '@/services/studioApiService';

interface UseQuizOptions { notebookId?: string; }
interface GenerateQuizParams {
  sources: LocalSource[]; numQuestions: number; difficulty: QuestionDifficulty;
  questionType?: QuestionType; model?: string;
}
export const useQuiz = ({ notebookId }: UseQuizOptions = {}) => {
  const queryClient = useQueryClient();
  const identity = useStudioIdentity(notebookId);
  const api = studioApi(identity.token);
  const quizKey = ['studio-quizzes', identity.owner, notebookId];
  const historyKey = ['quiz_history', identity.owner, notebookId];
  const [session, setCurrentSession] = useState<QuizSession | null>(null);
  const sessionOwner = useRef(identity.key);
  const currentSession = sessionOwner.current === identity.key ? session : null;
  const sessionRef = useRef(currentSession);
  sessionRef.current = currentSession;
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const pending = useRef<{ id: string; promise: Promise<{ score: number; historyEntry: QuizHistory } | null> } | null>(null);
  const queryEnabled = identity.ready && (!identity.authenticated || !!notebookId);
  const savedQuery = useQuery({ queryKey: quizKey, enabled: queryEnabled, queryFn: async () => {
    identity.assertCurrent();
    const quizzes = identity.authenticated ? await api.quizzes(notebookId!) : readGuestStudio<Quiz>(identity.owner, 'quizzes').filter(q => !notebookId || q.notebookId === notebookId);
    identity.assertCurrent(); return quizzes;
  } });
  const historyQuery = useQuery({ queryKey: historyKey, enabled: queryEnabled, queryFn: async () => {
    identity.assertCurrent();
    const history = identity.authenticated ? await api.attempts(notebookId!) : readGuestStudio<QuizHistory>(identity.owner, 'attempts').filter(h => !notebookId || h.notebookId === notebookId);
    identity.assertCurrent(); return history;
  } });
  const startQuiz = useCallback((quiz: Quiz) => {
    identity.assertCurrent();
    if (notebookId && quiz.notebookId !== notebookId) throw new Error('This quiz belongs to a different notebook.');
    sessionOwner.current = identity.key;
    const next: QuizSession = { quiz, attemptId: crypto.randomUUID(), results: [], currentQuestionIndex: 0,
      startedAt: new Date().toISOString(), isComplete: false };
    sessionRef.current = next;
    setCurrentSession(next); setCompletionError(null); setIsCompleting(false);
  }, [identity.key]);
  const generateQuizMutation = useMutation({
    mutationFn: async (params: GenerateQuizParams) => {
      identity.assertCurrent(); setGenerationError(null); setIsGenerating(true);
      try {
        const generated = await generateQuiz({ ...params, questionType: params.questionType || 'multiple_choice' });
        identity.assertCurrent();
        const quiz = { ...generated, notebookId: notebookId || generated.notebookId };
        const saved = identity.authenticated ? await api.createQuiz(quiz) : quiz;
        identity.assertCurrent();
        if (!identity.authenticated) writeGuestStudio(identity.owner, 'quizzes', [...readGuestStudio<Quiz>(identity.owner, 'quizzes'), saved]);
        startQuiz(saved);
        await queryClient.invalidateQueries({ queryKey: quizKey });
        return saved;
      } finally { try { identity.assertCurrent(); setIsGenerating(false); } catch { /* stale generation */ } }
    },
    onError: (error: Error) => { try { identity.assertCurrent(); setGenerationError(error.message); } catch { /* stale generation */ } },
  });
  useEffect(() => {
    sessionOwner.current = identity.key; sessionRef.current = null; setCurrentSession(null);
    setGenerationError(null); setCompletionError(null); setIsGenerating(false); setIsCompleting(false);
    pending.current = null; generateQuizMutation.reset();
  }, [identity.key]);
  const answerQuestion = useCallback((selectedAnswer: number, timeSpent: number) => {
    if (!currentSession || currentSession.isComplete) return;

    const currentQuestion = currentSession.quiz.questions[currentSession.currentQuestionIndex];
    if (!currentQuestion) return;
    const existingResult = currentSession.results.find(result => result.questionId === currentQuestion.id);
    if (existingResult) return existingResult;
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

    const result: QuizResult = {
      questionId: currentQuestion.id,
      selectedAnswer,
      isCorrect,
      timeSpent,
    };

    setCurrentSession(prev => {
      if (!prev || prev.isComplete || prev.attemptId !== currentSession.attemptId) return prev;
      if (prev.results.some(answer => answer.questionId === result.questionId)) return prev;
      // Keep the answered question visible until the learner dismisses its feedback.
      return { ...prev, results: [...prev.results, result] };
    });

    return result;
  }, [currentSession]);

  const nextQuestion = useCallback(() => {
    if (!currentSession) return;

    setCurrentSession(prev => {
      if (!prev || prev.isComplete || prev.attemptId !== currentSession.attemptId) return prev;
      const question = prev.quiz.questions[prev.currentQuestionIndex];
      if (!question || !prev.results.some(result => result.questionId === question.id)) return prev;
      
      const nextIndex = prev.currentQuestionIndex + 1;
      if (nextIndex >= prev.quiz.questions.length) {
        return prev;
      }
      
      return {
        ...prev,
        currentQuestionIndex: nextIndex,
      };
    });
  }, [currentSession]);

  const completeQuiz = useCallback((): Promise<{ score: number; historyEntry: QuizHistory } | null> => {
    const snapshot = sessionRef.current;
    if (!snapshot || snapshot.results.length !== snapshot.quiz.questions.length) return Promise.resolve(null);
    if (pending.current?.id === snapshot.attemptId) return pending.current.promise;
    const promise = (async () => {
      try {
        identity.assertCurrent(); setIsCompleting(true); setCompletionError(null);
        let historyEntry: QuizHistory;
        if (identity.authenticated) historyEntry = await api.complete(snapshot.quiz, snapshot.attemptId, snapshot.results, snapshot.startedAt);
        else {
          const history = readGuestStudio<QuizHistory>(identity.owner, 'attempts');
          historyEntry = history.find(h => h.id === snapshot.attemptId) || {
            id: snapshot.attemptId, quizId: snapshot.quiz.id, notebookId: snapshot.quiz.notebookId,
            title: snapshot.quiz.title, difficulty: snapshot.quiz.difficulty,
            score: calculateScore(snapshot.results), totalQuestions: snapshot.quiz.questions.length,
            startedAt: snapshot.startedAt, completedAt: new Date().toISOString(),
            results: snapshot.results.map(result => {
              const question = snapshot.quiz.questions.find(q => q.id === result.questionId)!;
              return { ...result, correctAnswer: question.correctAnswer, explanation: question.explanation };
            }),
          };
          if (!history.some(h => h.id === historyEntry.id)) writeGuestStudio(identity.owner, 'attempts', [historyEntry, ...history]);
        }
        identity.assertCurrent();
        if (sessionRef.current?.attemptId !== snapshot.attemptId) return null;
        const completed = { ...snapshot, results: historyEntry.results || snapshot.results, isComplete: true };
        sessionRef.current = completed; setCurrentSession(completed);
        await queryClient.invalidateQueries({ queryKey: historyKey });
        identity.assertCurrent();
        if (sessionRef.current?.attemptId !== snapshot.attemptId) return null;
        return { score: historyEntry.score, historyEntry };
      } catch (error) {
        try {
          identity.assertCurrent();
          if (sessionRef.current?.attemptId === snapshot.attemptId) setCompletionError(error instanceof Error ? error.message : 'Could not save this attempt. Please retry.');
        } catch { /* old account must not open results or show an unrelated error */ }
        return null;
      } finally {
        try { identity.assertCurrent(); if (sessionRef.current?.attemptId === snapshot.attemptId) setIsCompleting(false); } catch { /* stale completion */ }
        if (pending.current?.id === snapshot.attemptId) pending.current = null;
      }
    })();
    pending.current = { id: snapshot.attemptId, promise };
    return promise;
  }, [currentSession, identity.key, queryClient]);
  const resetQuiz = useCallback(() => {
    sessionRef.current = null; setCurrentSession(null); setGenerationError(null); setCompletionError(null); setIsCompleting(false);
  }, []);
  const retryQuiz = useCallback(() => { if (currentSession) startQuiz(currentSession.quiz); }, [currentSession, startQuiz]);
  const reopenAttempt = useCallback((attempt: QuizHistory): boolean => {
    identity.assertCurrent();
    const quiz = savedQuery.data?.find(q => q.id === attempt.quizId);
    if (!quiz || !attempt.results || (notebookId && attempt.notebookId !== notebookId)) return false;
    sessionOwner.current = identity.key;
    const next: QuizSession = { quiz, attemptId: attempt.id || crypto.randomUUID(), results: attempt.results,
      currentQuestionIndex: Math.max(0, quiz.questions.length - 1), startedAt: attempt.startedAt || attempt.completedAt, isComplete: true };
    sessionRef.current = next; setCurrentSession(next); setCompletionError(null); setIsCompleting(false); return true;
  }, [savedQuery.data, identity.key]);
  const getCurrentQuestion = useCallback(() => {
    if (!currentSession) return null;
    return currentSession.quiz.questions[currentSession.currentQuestionIndex];
  }, [currentSession]);

  const getProgress = useCallback(() => {
    if (!currentSession) return { current: 0, total: 0, percentage: 0 };
    
    const current = currentSession.currentQuestionIndex + 1;
    const total = currentSession.quiz.questions.length;
    const percentage = Math.round((currentSession.results.length / total) * 100);

    return { current, total, percentage };
  }, [currentSession]);

  return {
    currentSession, isGenerating, generationError, isCompleting, completionError,
    savedQuizzes: savedQuery.data || [], isLoadingQuizzes: savedQuery.isLoading,
    quizzesError: savedQuery.error?.message || null,
    quizHistory: historyQuery.data || [], isLoadingHistory: historyQuery.isLoading,
    historyError: historyQuery.error?.message || null,
    generateQuiz: generateQuizMutation.mutate, generateQuizAsync: generateQuizMutation.mutateAsync,
    startQuiz, openQuiz: startQuiz, reopenAttempt, answerQuestion, nextQuestion, completeQuiz, resetQuiz, retryQuiz,
    getCurrentQuestion, getProgress,
  };
};
