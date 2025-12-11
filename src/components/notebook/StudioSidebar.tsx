import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
// import { Plus, Edit, Bot, User, Brain, ChevronDown, ChevronUp, Layers, GitBranch, Loader2, Trash2, GitCompare } from 'lucide-react'; // Removed Lucide imports
import { useNotes, Note } from '@/hooks/useNotes';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useSources } from '@/hooks/useSources';
import { useQuiz } from '@/hooks/useQuiz';
import { useOllamaModels } from '@/hooks/useOllamaModels';
import { useConceptMap } from '@/hooks/useConceptMap';
import { useQueryClient } from '@tanstack/react-query';
import NoteEditor from './NoteEditor';
import PodcastView from './PodcastView';
import FlashcardDeckComponent from './FlashcardDeck';
import ConceptMapView from './ConceptMapView';
import SourceComparisonView from './SourceComparisonView';
import QuizSelector, { QuizConfig } from './QuizSelector';
import QuizView from './QuizView';
import QuizResults from './QuizResults';
import { Citation } from '@/types/message';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GlareCard } from '@/components/ui/glare-card';

interface StudioSidebarProps {
  notebookId?: string;
  isExpanded?: boolean;
  onCitationClick?: (citation: Citation) => void;
}

const StudioSidebar = ({
  notebookId,
  isExpanded,
  onCitationClick
}: StudioSidebarProps) => {
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isQuizSectionOpen, setIsQuizSectionOpen] = useState(true);
  const [isFlashcardSectionOpen, setIsFlashcardSectionOpen] = useState(false);
  const [isConceptMapSectionOpen, setIsConceptMapSectionOpen] = useState(false);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showQuizResults, setShowQuizResults] = useState(false);
  const {
    notes,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    isCreating,
    isUpdating,
    isDeleting
  } = useNotes(notebookId);
  const {
    notebooks
  } = useNotebooks();
  const {
    sources
  } = useSources(notebookId);
  const {
    currentSession,
    isGenerating,
    generationError,
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
    isLoading: isLoadingMaps,
    generatingProgress,
    generateMap,
    isGenerating: isGeneratingMap,
    deleteMap,
    isDeleting: isDeletingMap,
  } = useConceptMap(notebookId);
  const queryClient = useQueryClient();
  const notebook = notebooks?.find(n => n.id === notebookId);

  const handleGenerateConceptMap = () => {
    if (!notebookId || !sources || sources.length === 0) return;
    
    const combinedContent = sources
      .map(s => `${s.title}:\n${s.content || s.summary || ''}`)
      .join('\n\n');
    
    generateMap({
      content: combinedContent,
      title: notebook?.title || 'Concept Map',
      notebookId,
    });
  };

  const handleCreateNote = () => {
    setIsCreatingNote(true);
    setEditingNote(null);
  };

  const handleEditNote = (note: Note) => {
    console.log('StudioSidebar: Opening note', {
      noteId: note.id,
      sourceType: note.source_type
    });
    setEditingNote(note);
    setIsCreatingNote(false);
  };

  const handleSaveNote = (title: string, content: string) => {
    if (editingNote) {
      // Only allow updating user notes, not AI responses
      if (editingNote.source_type === 'user') {
        updateNote({
          id: editingNote.id,
          title,
          content
        });
      }
    } else {
      createNote({
        title,
        content,
        source_type: 'user'
      });
    }
    setEditingNote(null);
    setIsCreatingNote(false);
  };

  const handleDeleteNote = () => {
    if (editingNote) {
      deleteNote(editingNote.id);
      setEditingNote(null);
    }
  };

  const handleCancel = () => {
    setEditingNote(null);
    setIsCreatingNote(false);
  };

  const handleStartQuiz = (config: QuizConfig) => {
    if (!sources || sources.length === 0) return;
    
    generateQuiz({
      sources,
      numQuestions: config.numQuestions,
      difficulty: config.difficulty,
      questionType: config.questionType,
      model: config.model,
    });
  };

  const handleQuizComplete = () => {
    completeQuiz();
    setShowQuizResults(true);
  };

  const handleQuizRetry = () => {
    setShowQuizResults(false);
    retryQuiz();
  };

  const handleQuizClose = () => {
    setShowQuizResults(false);
    resetQuiz();
  };

  const isEditingMode = editingNote || isCreatingNote;
  const isQuizActive = currentSession && !currentSession.isComplete;
  const isQuizCompleted = currentSession && currentSession.isComplete;
  const getPreviewText = (note: Note) => {
    if (note.source_type === 'ai_response') {
      // Use extracted_text if available, otherwise parse the content
      if (note.extracted_text) {
        return note.extracted_text;
      }
      try {
        const parsed = JSON.parse(note.content);
        if (parsed.segments && parsed.segments[0]) {
          return parsed.segments[0].text;
        }
      } catch (e) {
        // If parsing fails, use content as-is
      }
    }

    // For user notes or fallback, use the content directly
    const contentToUse = note.content;
    return contentToUse.length > 100 ? contentToUse.substring(0, 100) + '...' : contentToUse;
  };

  if (isEditingMode) {
    return <div className="w-full bg-gray-50 border-l border-gray-200 flex flex-col h-full overflow-hidden">
        <NoteEditor note={editingNote || undefined} onSave={handleSaveNote} onDelete={editingNote ? handleDeleteNote : undefined} onCancel={handleCancel} isLoading={isCreating || isUpdating || isDeleting} onCitationClick={onCitationClick} />
      </div>;
  }

  if (isQuizActive && currentSession) {
    const currentQuestion = getCurrentQuestion();
    const progress = getProgress();
    
    if (currentQuestion) {
      return (
        <div className="w-full bg-gray-50 border-l border-gray-200 flex flex-col h-full overflow-hidden">
          <QuizView
            question={currentQuestion}
            questionNumber={progress.current}
            totalQuestions={progress.total}
            onAnswer={answerQuestion}
            onNext={nextQuestion}
            onComplete={handleQuizComplete}
            isLastQuestion={progress.current === progress.total}
          />
        </div>
      );
    }
  }

  if ((isQuizCompleted || showQuizResults) && currentSession) {
    return (
      <div className="w-full bg-gray-50 border-l border-gray-200 flex flex-col h-full overflow-hidden">
        <QuizResults
          quiz={currentSession.quiz}
          results={currentSession.results}
          onRetry={handleQuizRetry}
          onClose={handleQuizClose}
        />
      </div>
    );
  }

  return <div className="w-full bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h2 className="text-lg font-medium text-foreground">Studio</h2>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
        {/* Audio Overview */}
        <div className="mb-6">
          {notebookId && <PodcastView notebookId={notebookId} />}
        </div>

        {/* Notes Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-foreground">Notes</h3>
            
          </div>
          
          <Button variant="outline" size="sm" className="w-full mb-4" onClick={handleCreateNote}>
            <i className="fi fi-rr-plus mr-2"></i>
            Add note
          </Button>
        </div>

        {/* Quiz Section */}
        <Collapsible open={isQuizSectionOpen} onOpenChange={setIsQuizSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-brain text-green-600"></i>
              <h3 className="font-medium text-foreground">Quiz</h3>
            </div>
            {isQuizSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {notebookId && sources && sources.length > 0 ? (
              <QuizSelector
                onStart={handleStartQuiz}
                isGenerating={isGenerating}
                error={generationError}
                sourcesCount={sources.length}
                availableModels={installedModels || []}
              />
            ) : (
              <p className="text-xs text-gray-500 text-center py-2">
                Add sources to generate a quiz
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Flashcards Section */}
        <Collapsible open={isFlashcardSectionOpen} onOpenChange={setIsFlashcardSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-layers text-purple-600"></i>
              <h3 className="font-medium text-foreground">Flashcards</h3>
            </div>
            {isFlashcardSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {notebookId && <FlashcardDeckComponent notebookId={notebookId} />}
          </CollapsibleContent>
        </Collapsible>

        {/* Concept Map Section */}
        <Collapsible open={isConceptMapSectionOpen} onOpenChange={setIsConceptMapSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-code-branch text-blue-600"></i>
              <h3 className="font-medium text-foreground">Concept Map</h3>
            </div>
            {isConceptMapSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {notebookId && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleGenerateConceptMap}
                  disabled={isGeneratingMap || !sources || sources.length === 0}
                >
                  {isGeneratingMap ? (
                    <>
                      <i className="fi fi-rr-spinner mr-2 animate-spin"></i>
                      {generatingProgress || 'Generating...'}
                    </>
                  ) : (
                    <>
                      <i className="fi fi-rr-code-branch mr-2"></i>
                      Generate from sources
                    </>
                  )}
                </Button>

                {conceptMaps.length > 0 && (
                  <div className="space-y-2">
                    {conceptMaps.map((map) => (
                      <Card key={map.id} className="p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium truncate">{map.title}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => deleteMap(map.id)}
                            disabled={isDeletingMap}
                          >
                            <i className="fi fi-rr-trash text-gray-500"></i>
                          </Button>
                        </div>
                        <ConceptMapView conceptMap={map} />
                      </Card>
                    ))}
                  </div>
                )}

                {conceptMaps.length === 0 && !isGeneratingMap && (
                  <p className="text-xs text-gray-500 text-center py-2">
                    Generate a concept map to visualize relationships between ideas
                  </p>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Source Comparison Section */}
        <Collapsible open={isComparisonOpen} onOpenChange={setIsComparisonOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-code-compare text-orange-600"></i>
              <h3 className="font-medium text-foreground">Compare Sources</h3>
            </div>
            {isComparisonOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {notebookId && sources && sources.length >= 2 ? (
              <SourceComparisonView
                sources={sources}
                notebookId={notebookId}
                onClose={() => setIsComparisonOpen(false)}
              />
            ) : (
              <p className="text-xs text-gray-500 text-center py-2">
                Add at least 2 sources to compare them
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Saved Notes Area */}
        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="font-medium text-foreground mb-3">Saved Notes</h3>
          {isLoading ? <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Loading notes...</p>
            </div> : notes && notes.length > 0 ? <div className="space-y-3">
              {notes.map(note => <GlareCard key={note.id} className="p-3 border border-border cursor-pointer group" onClick={() => handleEditNote(note)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        {note.source_type === 'ai_response' ? <i className="fi fi-rr-robot text-blue-600"></i> : <i className="fi fi-rr-user text-muted-foreground"></i>}
                        <span className="text-xs text-muted-foreground uppercase">
                          {note.source_type === 'ai_response' ? 'AI Response' : 'Note'}
                        </span>
                      </div>
                      <h4 className="font-medium text-foreground truncate">{note.title}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {getPreviewText(note)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(note.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    {note.source_type === 'user' && <Button variant="ghost" size="sm" className="ml-2">
                        <i className="fi fi-rr-edit"></i>
                      </Button>}
                  </div>
                </GlareCard>)}
            </div> : <div className="text-center py-8">
              <div className="w-16 h-16 bg-muted rounded-lg mx-auto mb-4 flex items-center justify-center">
                <span className="text-muted-foreground text-2xl">📄</span>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Saved notes will appear here</h3>
              <p className="text-sm text-muted-foreground">
                Save a chat message to create a new note, or click Add note above.
              </p>
            </div>}
        </div>
        </div>
      </ScrollArea>
    </div>;
};

export default StudioSidebar;
