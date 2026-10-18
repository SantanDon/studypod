import { useEffect, useState } from 'react';
import { useStudioIdentity } from '@/services/studioApiService';
import type { Quiz, QuizHistory } from '@/types/quiz';
import { useNotes, Note } from '@/hooks/useNotes';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useSources } from '@/hooks/useSources';
import { useQuiz } from '@/hooks/useQuiz';
import { useOllamaModels } from '@/hooks/useOllamaModels';
import { useConceptMap } from '@/hooks/useConceptMap';
import { QuizConfig } from '../QuizSelector';
import { isSourceUsableForGroundedWork } from '@/lib/sources/sourceProcessing';

export function useStudioSidebar(notebookId?: string) {
  const identity = useStudioIdentity(notebookId);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isQuizSectionOpen, setIsQuizSectionOpen] = useState(false);
  const [isFlashcardSectionOpen, setIsFlashcardSectionOpen] = useState(false);
  const [isConceptMapSectionOpen, setIsConceptMapSectionOpen] = useState(false);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showQuizResults, setShowQuizResults] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  useEffect(() => {
    setEditingNote(null);
    setIsCreatingNote(false);
    setShowQuizResults(false);
    setNoteError(null);
    setIsConceptMapSectionOpen(false);
    setIsComparisonOpen(false);
  }, [identity.key]);

  const {
    notes,
    isLoading,
    createNoteAsync,
    updateNoteAsync,
    deleteNoteAsync,
    isCreating,
    isUpdating,
    isDeleting
  } = useNotes(notebookId);

  const { notebooks } = useNotebooks();
  const { sources, isLoading: sourcesLoading, isFetching: sourcesFetching, error: sourcesError, retrySources } = useSources(notebookId);
  const usableSources = (sources || []).filter(isSourceUsableForGroundedWork);

  const {
    currentSession,
    isGenerating,
    generationError,
    isCompleting,
    completionError,
    savedQuizzes, quizHistory, quizzesError, historyError, isLoadingQuizzes, isLoadingHistory,
    openQuiz, reopenAttempt,
    generateQuiz,
    answerQuestion,
    nextQuestion,
    completeQuiz,
    resetQuiz,
    retryQuiz,
    getCurrentQuestion,
    getProgress,
  } = useQuiz({ notebookId });

  const { installedModels } = useOllamaModels();

  const {
    conceptMaps,
    generatingProgress,
    generateMapAsync,
    isGenerating: isGeneratingMap,
    deleteMapAsync,
    isDeleting: isDeletingMap,
    loadError: mapLoadError,
    mutationError: mapMutationError,
  } = useConceptMap(notebookId);

  const notebook = notebooks?.find((n: { id: string }) => n.id === notebookId);

  const handleGenerateConceptMap = async () => {
    if (!notebookId || usableSources.length === 0) return;
    
    const combinedContent = usableSources
      .map(s => `${s.title}:\n${s.content || s.summary || ''}`)
      .join('\n\n');
    
    try { await generateMapAsync({
      content: combinedContent,
      title: notebook?.title || 'Concept Map',
      notebookId,
    }); } catch { /* The map hook exposes the failure without losing saved maps. */ }
  };

  const deleteMap = async (id: string) => {
    try { await deleteMapAsync(id); } catch { /* Keep the saved map visible and show the hook error. */ }
  };

  const handleCreateNote = () => {
    setNoteError(null);
    setIsCreatingNote(true);
    setEditingNote(null);
  };

  const handleEditNote = (note: Note) => {
    setNoteError(null);
    setEditingNote(note);
    setIsCreatingNote(false);
  };

  const handleSaveNote = async (title: string, content: string) => {
    setNoteError(null);
    try {
    if (editingNote) {
      if (editingNote.source_type === 'user') {
        await updateNoteAsync({
          id: editingNote.id,
          title,
          content
        });
      }
    } else {
      await createNoteAsync({
        title,
        content,
        source_type: 'user'
      });
    }
    identity.assertCurrent();
    setEditingNote(null);
    setIsCreatingNote(false);
    } catch (error) {
      try { identity.assertCurrent(); setNoteError(error instanceof Error ? error.message : 'Could not save your note. Your edits are still here.'); } catch { /* account changed */ }
    }
  };

  const handleDeleteNote = async () => {
    setNoteError(null);
    try {
    if (editingNote) {
      await deleteNoteAsync(editingNote.id);
      identity.assertCurrent();
      setEditingNote(null);
    }
    } catch (error) {
      try { identity.assertCurrent(); setNoteError(error instanceof Error ? error.message : 'Could not delete your note. Try again.'); } catch { /* account changed */ }
    }
  };

  const handleCancel = () => {
    setEditingNote(null);
    setIsCreatingNote(false);
  };

  const handleStartQuiz = (config: QuizConfig) => {
    if (usableSources.length === 0) return;
    
    generateQuiz({
      sources: usableSources,
      numQuestions: config.numQuestions,
      difficulty: config.difficulty,
      questionType: config.questionType,
      model: config.model,
    });
  };

  const handleQuizComplete = async () => {
    const completed = await completeQuiz();
    if (completed) setShowQuizResults(true);
  };

  const handleQuizRetry = () => {
    setShowQuizResults(false);
    retryQuiz();
  };

  const handleQuizClose = () => {
    setShowQuizResults(false);
    resetQuiz();
  };
  const handleOpenSavedQuiz = (quiz: Quiz) => {
    setShowQuizResults(false);
    openQuiz(quiz);
  };
  const handleOpenQuizAttempt = (attempt: QuizHistory) => {
    if (reopenAttempt(attempt)) setShowQuizResults(true);
  };

  const isEditingMode = editingNote || isCreatingNote;
  const isQuizActive = currentSession && !currentSession.isComplete;
  const isQuizCompleted = currentSession && currentSession.isComplete;

  const getPreviewText = (note: Note) => {
    if (note.source_type === 'ai_response') {
      if (note.extracted_text) {
        return note.extracted_text;
      }
      try {
        const parsed = JSON.parse(note.content);
        if (parsed.segments && parsed.segments[0]) {
          return parsed.segments[0].text;
        }
      } catch (e) {
        // Fallback for non-JSON content or parsing errors
      }
    }
    const contentToUse = note.content;
    return contentToUse.length > 100 ? contentToUse.substring(0, 100) + '...' : contentToUse;
  };

  return {
    state: {
      editingNote,
      isCreatingNote,
      isQuizSectionOpen, setIsQuizSectionOpen,
      isFlashcardSectionOpen, setIsFlashcardSectionOpen,
      isConceptMapSectionOpen, setIsConceptMapSectionOpen,
      isComparisonOpen, setIsComparisonOpen,
      showQuizResults, setShowQuizResults
    },
    data: {
      notes, sources, usableSources, sourcesLoading, sourcesFetching, sourcesError, retrySources, installedModels, conceptMaps, currentSession, savedQuizzes, quizHistory
    },
    flags: {
      isLoading, isCreating, isUpdating, isDeleting,
      isGenerating, isGeneratingMap, isDeletingMap, isCompleting, isLoadingQuizzes, isLoadingHistory,
      isEditingMode, isQuizActive, isQuizCompleted
    },
    misc: {
      generationError, generatingProgress, completionError, noteError, quizzesError, historyError, mapLoadError, mapMutationError
    },
    handlers: {
      handleGenerateConceptMap,
      handleCreateNote, handleEditNote, handleSaveNote, handleDeleteNote, handleCancel,
      handleStartQuiz, handleQuizComplete, handleQuizRetry, handleQuizClose,
      handleOpenSavedQuiz, handleOpenQuizAttempt,
      answerQuestion, nextQuestion, getPreviewText, getCurrentQuestion, getProgress, deleteMap
    }
  };
}
