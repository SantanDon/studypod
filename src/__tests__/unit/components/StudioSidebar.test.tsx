import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudioSidebar from '@/components/notebook/StudioSidebar';

const mockSetComparisonOpen = vi.fn();
const mockGenerateQuiz = vi.fn();
const mockGenerateCards = vi.fn();
let sourceType = 'text';
let processingOnly = false;

vi.mock('@/services/studioApiService', () => ({
  useStudioIdentity: () => ({ key: 'account:test:notebook-1', assertCurrent: vi.fn() }),
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [],
    isLoading: false,
    createNoteAsync: vi.fn(),
    updateNoteAsync: vi.fn(),
    deleteNoteAsync: vi.fn(),
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
  }),
}));

vi.mock('@/hooks/useNotebooks', () => ({
  useNotebooks: () => ({ notebooks: [{ id: 'notebook-1', title: 'Test Notebook' }] }),
}));

vi.mock('@/hooks/useSources', () => ({
  useSources: () => ({
    sources: [
      {
        id: 'source-1',
        notebook_id: 'notebook-1',
        title: 'First source',
        type: sourceType,
        content: 'First source content',
        processing_status: processingOnly ? 'processing' : 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'source-2',
        notebook_id: 'notebook-1',
        title: 'Second source',
        type: sourceType,
        content: 'Second source content',
        processing_status: processingOnly ? 'processing' : 'ready',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'source-3',
        notebook_id: 'notebook-1',
        title: 'Processing source',
        type: sourceType,
        content: 'This source must not power grounded outputs yet',
        processing_status: 'processing',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  }),
}));

vi.mock('@/hooks/useQuiz', () => ({
  useQuiz: () => ({
    currentSession: null,
    isGenerating: false,
    generationError: null,
    isCompleting: false,
    completionError: null,
    savedQuizzes: [],
    quizHistory: [],
    quizzesError: null,
    historyError: null,
    isLoadingQuizzes: false,
    isLoadingHistory: false,
    openQuiz: vi.fn(),
    reopenAttempt: vi.fn(),
    generateQuiz: mockGenerateQuiz,
    answerQuestion: vi.fn(),
    nextQuestion: vi.fn(),
    completeQuiz: vi.fn(),
    resetQuiz: vi.fn(),
    retryQuiz: vi.fn(),
    getCurrentQuestion: vi.fn(),
    getProgress: vi.fn(() => ({ current: 0, total: 0 })),
  }),
}));

vi.mock('@/hooks/useOllamaModels', () => ({
  useOllamaModels: () => ({ installedModels: [] }),
}));

vi.mock('@/hooks/useConceptMap', () => ({
  useConceptMap: () => ({
    conceptMaps: [],
    generatingProgress: '',
    generateMapAsync: vi.fn(),
    isGenerating: false,
    deleteMapAsync: vi.fn(),
    isDeleting: false,
    loadError: null,
    mutationError: null,
  }),
}));

vi.mock('@/hooks/useFlashcards', () => ({
  useFlashcards: () => ({
    decks: [{ id: 'deck-1', name: 'Bookmark review', cards: [] }],
    isLoading: false,
    generatingProgress: '',
    createDeck: vi.fn(),
    isCreatingDeck: false,
    deleteDeck: vi.fn(),
    isDeletingDeck: false,
    reviewCardAsync: vi.fn(),
    scopeKey: 'account:test:notebook-1',
    loadError: null,
    mutationError: null,
    isReviewing: false,
    generateFromSource: mockGenerateCards,
    getDueCards: () => [],
    getDeckStats: () => ({ cardsDue: 0, cardsLearning: 0, cardsMastered: 0, averageAccuracy: 0 }),
  }),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/notebook/NoteEditor', () => ({ default: () => <div>Note editor</div> }));
vi.mock('@/components/notebook/PodcastView', () => ({ default: () => <div>Audio Overview</div> }));
vi.mock('@/components/notebook/ConceptMapView', () => ({ default: () => <div>Concept map view</div> }));
vi.mock('@/components/notebook/SourceComparisonView', () => ({
  default: () => {
    mockSetComparisonOpen();
    return <div>Source comparison view</div>;
  },
}));
vi.mock('@/components/notebook/QuizSelector', () => ({
  default: ({ sourcesCount, onStart }: { sourcesCount: number; onStart: (config: { numQuestions: number; difficulty: 'medium'; questionType: 'multiple-choice'; model: string }) => void }) => (
    <div>
      Quiz settings panel ({sourcesCount})
      <button onClick={() => onStart({ numQuestions: 5, difficulty: 'medium', questionType: 'multiple-choice', model: 'test-model' })}>Start test quiz</button>
    </div>
  ),
}));
vi.mock('@/components/notebook/QuizView', () => ({ default: () => <div>Quiz view</div> }));
vi.mock('@/components/notebook/QuizResults', () => ({ default: () => <div>Quiz results</div> }));
vi.mock('@/components/notebook/SignalQueuePanel', () => ({ default: () => <div>Signal queue</div> }));
vi.mock('@/components/notebook/ResearchGoalsPanel', () => ({ default: () => <div>Research goals panel</div> }));
vi.mock('@/components/notebook/AgentMissionPanel', () => ({ default: () => <div>Agent mission panel</div> }));
vi.mock('@/components/notebook/AudiobookView', () => ({ default: () => <div>Audiobook workspace</div> }));

const renderStudioSidebar = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudioSidebar notebookId="notebook-1" />
    </QueryClientProvider>,
  );
};

describe('StudioSidebar', () => {
  // jsdom does not implement these DOM methods used by real Radix Select.
  const domMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const;
  const originalMethods = domMethods.map(name => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
  beforeAll(() => {
    domMethods.forEach(name => {
      if (!originalMethods[domMethods.indexOf(name)]) {
        Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: name === 'hasPointerCapture' ? () => false : () => undefined });
      }
    });
  });
  afterAll(() => {
    domMethods.forEach((name, index) => {
      const descriptor = originalMethods[index];
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    sourceType = 'text';
    processingOnly = false;
  });
  it('presents a source-first hierarchy with advanced tools collapsed', async () => {
    const user = userEvent.setup();
    renderStudioSidebar();

    const audioStudio = screen.getByRole('region', { name: 'Audio studio' });
    expect(within(audioStudio).getByRole('heading', { name: 'Audio Overview' })).toBeVisible();
    expect(screen.getByText('2 of 3 sources ready')).toBeInTheDocument();
    expect(screen.getByText('By default, Audio Overview draws on excerpts from every ready source in this notebook. Other sources are skipped.')).toBeInTheDocument();
    expect(screen.getByText('Create from sources')).toBeInTheDocument();
    expect(screen.getByText('Research workflows')).toBeInTheDocument();
    expect(screen.getByText('Study and review')).toBeInTheDocument();
    expect(screen.getAllByText('Audiobook')).toHaveLength(1);
    expect(screen.queryByText('Quiz settings panel (2)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Quiz/i }));
    expect(screen.getByText('Quiz settings panel (2)')).toBeInTheDocument();
  });

  it('opens the comparison controls before entering the comparison workspace', async () => {
    const user = userEvent.setup();
    renderStudioSidebar();

    expect(screen.queryByText('Source comparison view')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Compare Sources/i }));
    expect(screen.getByRole('button', { name: /Open comparison/i })).toBeInTheDocument();
    expect(screen.queryByText('Source comparison view')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open comparison/i }));
    expect(screen.getByText('Source comparison view')).toBeInTheDocument();
    expect(mockSetComparisonOpen).toHaveBeenCalled();
  });

  it('opens bookmark study tools and passes only ready tweets into grounded generation', async () => {
    sourceType = 'tweet';
    const user = userEvent.setup();
    renderStudioSidebar();

    const quiz = screen.getByRole('button', { name: /^Quiz\b/i });
    const flashcards = screen.getByRole('button', { name: /^Flashcards\b/i });
    expect(quiz).toHaveAttribute('aria-expanded', 'false');
    expect(flashcards).toHaveAttribute('aria-expanded', 'false');
    await user.click(quiz);
    expect(quiz).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Quiz settings panel (2)')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start test quiz' }));
    expect(mockGenerateQuiz).toHaveBeenCalledTimes(1);
    expect(mockGenerateQuiz.mock.calls[0][0].sources.map((source: { id: string }) => source.id)).toEqual(['source-1', 'source-2']);

    await user.click(flashcards);
    expect(flashcards).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /^Generate$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Generate Flashcards' });
    const selects = within(dialog).getAllByRole('combobox');
    await user.click(selects[0]);
    await user.click(screen.getByRole('option', { name: 'Bookmark review' }));
    await user.click(selects[1]);
    expect(screen.getByRole('option', { name: 'First source' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Second source' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Processing source' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'First source' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate Cards' }));
    expect(mockGenerateCards).toHaveBeenCalledWith('deck-1', 'source-1', 'First source', 'First source content', 5);
  });

  it('exposes Audio Overview and accessible comparison controls for ready bookmarks', async () => {
    sourceType = 'tweet';
    const user = userEvent.setup();
    renderStudioSidebar();
    expect(screen.getByRole('heading', { name: 'Audio Overview' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Compare Sources/i }));
    expect(screen.getByRole('button', { name: /Open comparison/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Open comparison/i }));
    expect(screen.getByText('Source comparison view')).toBeVisible();
  });

  it('keeps all-processing bookmark sources out of Quiz, Flashcards and comparison generation', async () => {
    sourceType = 'tweet';
    processingOnly = true;
    const user = userEvent.setup();
    renderStudioSidebar();

    await user.click(screen.getByRole('button', { name: /^Quiz\b/i }));
    expect(screen.getByText('Add a source or wait for processing to finish before generating a quiz.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start test quiz' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Flashcards\b/i }));
    expect(screen.getByRole('button', { name: /^Generate$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Compare Sources/i }));
    expect(screen.getByRole('button', { name: /Open comparison/i })).toBeDisabled();
    expect(mockGenerateQuiz).not.toHaveBeenCalled();
    expect(mockGenerateCards).not.toHaveBeenCalled();
  });
});
