import StudioAudioCommandCard from './StudioAudioCommandCard';
import { parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bot, List, Loader2, MessageSquare, RefreshCw, Search, Send, Share2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatMessages, type ChatMessageRequest } from '@/hooks/useChatMessages';
import { useSources } from '@/hooks/useSources';
import { useGuest, useNotebookLimits } from '@/hooks/useGuest';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import ChatInput from '@/components/chat/ChatInput';
import SovereignChatIntro from '@/components/chat/SovereignChatIntro';
import CaptureButtons from './CaptureButtons';
import ChatEvidenceScope, { ChatEvidenceScopeValue } from './ChatEvidenceScope';
import { Citation, EnhancedChatMessage } from '@/types/message';
import { IMMERSIVE_PROMPTS, BOOKMARK_PROMPTS, CHAT_FOLLOW_UP_PROMPTS } from '@/config/prompts';
import { useToast } from '@/hooks/use-toast';
import { formatDisplayTitle } from '@/lib/utils/displayTitle';
import { useAudiobookStore } from '@/stores/audiobookStore';
import type { AudiobookReadingContext } from '@/stores/audiobookStore';
import { getReadingFollowUpPrompts, getVisibleChatQuestion, withAudiobookReadingContext } from '@/lib/audio/readingContext';
import {
  getSourceProcessingStatus,
  isSourceUsableForGroundedChat,
  parseSourceProcessingMetadata,
} from '@/lib/sources/sourceProcessing';
import {
  AUDIO_LISTENING_QUESTION_EVENT,
  buildAudioListeningQuestionMessage,
  clearQueuedAudioListeningQuestion,
  consumeQueuedAudioListeningQuestion,
  type AudioListeningQuestionRequest,
} from '@/lib/audio/listeningQuestion';
import AddSourcesDialog from './AddSourcesDialog';
import {
  SOURCE_LEARNING_QUESTION_EVENT,
  buildSourceLearningQuestionMessage,
  claimSourceLearningQuestion,
  consumeQueuedSourceLearningQuestion,
  restoreSourceLearningDraft,
  serializeSourceLearningDraft,
  type SourceLearningDraft,
  type SourceLearningQuestionRequest,
} from '@/lib/sources/sourceLearningQuestion';
const ResearchFurtherDialog = lazy(() => import('./ResearchFurtherDialog'));

const DialogLoading = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
    <div className="rounded-xl border border-border bg-background px-5 py-3 text-sm text-muted-foreground shadow-xl">
      Loading…
    </div>
  </div>
);

export const resolveChatSourceIds = ({
  explicitSourceIds,
  chatScope,
  activeSourceId,
  hasExplicitAllScope,
  readingSourceId,
  readingSourceUsable,
}: {
  explicitSourceIds?: string[];
  chatScope: ChatEvidenceScopeValue;
  activeSourceId?: string | null;
  hasExplicitAllScope: boolean;
  readingSourceId?: string | null;
  readingSourceUsable: boolean;
}): string[] | undefined => {
  if (explicitSourceIds) return explicitSourceIds;
  if (chatScope === 'active' && activeSourceId) return [activeSourceId];
  if (hasExplicitAllScope || !readingSourceUsable || !readingSourceId) return undefined;
  return [readingSourceId];
};

export const resolveUsableAudiobookReadingContext = (
  context: AudiobookReadingContext | undefined,
  readingSourceUsable: boolean,
): AudiobookReadingContext | undefined => (
  readingSourceUsable && context?.sourceId ? context : undefined
);

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ChatAreaProps {
  hasSource: boolean;
  notebookId?: string;
  notebook?: {
    id: string;
    title: string;
    description?: string;
    generation_status?: string;
    icon?: string;
    example_questions?: string[];
    joinCode?: string;
    join_code?: string;
  } | null;
  activeSourceId?: string | null;
  onCitationClick?: (citation: Citation) => void;
}



const ChatArea = ({
  hasSource,
  notebookId,
  notebook,
  activeSourceId,
  onCitationClick
}: ChatAreaProps) => {
  const [message, setMessage] = useState('');
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const learningDraftRef = useRef<SourceLearningDraft | null>(null);
  const learningRequestInFlight = useRef(false);
  const [chatScope, setChatScope] = useState<ChatEvidenceScopeValue>('all');
  const [hasExplicitAllScope, setHasExplicitAllScope] = useState(false);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showAiLoading, setShowAiLoading] = useState(false);
  const [clickedQuestions, setClickedQuestions] = useState<Set<string>>(new Set());
  const [showAddSourcesDialog, setShowAddSourcesDialog] = useState(false);
  const [showResearchDialog, setShowResearchDialog] = useState(false);
  const [chatMode, setChatMode] = useState<'study' | 'agent'>('study');
  const [responseStyle, setResponseStyle] = useState<'dense' | 'conversational'>('dense');
  const { toast } = useToast();
  const [isShareOpen, setIsShareOpen] = useState(false);
  const retryHandlerRef = useRef<((request: ChatMessageRequest) => void) | null>(null);
  const readingContext = useAudiobookStore((state) => notebookId
    ? state.readingContextByNotebook?.[notebookId]
    : undefined);
  
  const { isGuest, incrementUsage, showAuthPrompt } = useGuest();
  const { canSendMessage, messagesRemaining } = useNotebookLimits(notebookId);
  
  const isGenerating = notebook?.generation_status === 'generating' || notebook?.generation_status === 'processing';
  
  const {
    messages,
    sendMessageAsync,
    isSending,
    deleteChatHistory,
    isDeletingChatHistory
  } = useChatMessages(notebookId, (request) => retryHandlerRef.current?.(request));
  
  const {
    sources,
    isLoading: sourcesLoading,
    isFetching: sourcesFetching,
    error: sourcesError,
    retrySources
  } = useSources(notebookId);

  const readingSourceUsable = Boolean(readingContext?.sourceId && sources?.some((source) =>
    source.id === readingContext.sourceId && isSourceUsableForGroundedChat(source)));
  const usableReadingContext = resolveUsableAudiobookReadingContext(readingContext, readingSourceUsable);
  
  const sourceCount = sources?.length || 0;
  const activeSource = sources?.find((source) => source.id === activeSourceId) || null;
  const activeSourceUsable = activeSource ? isSourceUsableForGroundedChat(activeSource) : false;
  const draftStorageKey = notebookId ? `studypod:chat-draft:${notebookId}` : null;

  const hasReadySource = sources?.some(isSourceUsableForGroundedChat) || false;
  const hasMetadataOnlySource = sources?.some((source) => {
    const metadata = parseSourceProcessingMetadata(source.metadata);
    return source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  }) || false;
  const hasProcessingSource = sources?.some((source) => {
    const status = getSourceProcessingStatus(source);
    return status === 'pending' || status === 'uploading' || status === 'extracting' || status === 'processing' || status === 'indexing';
  }) || false;
  const hasFailedSource = sources?.some((source) => getSourceProcessingStatus(source) === 'failed') || false;
  const hasConversation = messages.length > 0 || !!pendingUserMessage || showAiLoading || !!failedMessage;

  const isChatDisabled = sourceCount === 0 || !hasReadySource || (chatScope === 'active' && !activeSourceUsable);

  // Track when we send a message to show loading state

  // Ref for auto-scrolling to the most recent message
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    learningDraftRef.current = null;
    if (!draftStorageKey) {
      setMessage('');
      setHydratedDraftKey(null);
      return;
    }
    try {
      const restored = restoreSourceLearningDraft(localStorage.getItem(draftStorageKey) || '', notebookId!);
      learningDraftRef.current = restored.draft;
      setMessage(restored.content);
    } catch {
      setMessage('');
    }
    setFailedMessage(null);
    setHydratedDraftKey(draftStorageKey);
  }, [draftStorageKey, notebookId]);

  useEffect(() => {
    if (!draftStorageKey || hydratedDraftKey !== draftStorageKey) return;
    try {
      const draft = learningDraftRef.current;
      // A reload during a request should recover the scoped question too.
      const content = message || (draft?.notebookId === notebookId && draft.content === pendingUserMessage ? pendingUserMessage : '') || '';
      if (content.trim()) localStorage.setItem(draftStorageKey, serializeSourceLearningDraft(content, notebookId!, draft));
      else localStorage.removeItem(draftStorageKey);
    } catch {
      // Draft persistence is best-effort and must never block chat.
    }
  }, [draftStorageKey, hydratedDraftKey, message, notebookId, pendingUserMessage]);

  const handleMessageChange = useCallback((content: string) => {
    // Editing creates an ordinary draft; never attach a previous passage's scope.
    learningDraftRef.current = null;
    setMessage(content);
  }, []);

  useEffect(() => {
    if (chatScope === 'active' && !activeSourceUsable) {
      setChatScope('all');
      setHasExplicitAllScope(false);
    }
  }, [activeSourceUsable, chatScope]);
  // Auto-scroll when pending message is set, when messages update, or when AI loading appears
  useEffect(() => {
    if (latestMessageRef.current && scrollAreaRef.current) {
      // Find the viewport within the ScrollArea
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        // Use a small delay to ensure the DOM has updated
        setTimeout(() => {
          latestMessageRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }, 50);
      }
    }
  }, [pendingUserMessage, messages.length, showAiLoading]);
  const handleSendMessage = useCallback(async (messageText?: string, sourceIdsOverride?: string[], isToastRetry = false) => {
    const textToSend = messageText || message.trim();
    if (textToSend && notebookId) {
      const learningDraft = learningDraftRef.current;
      const isLearningDraft = learningDraft?.notebookId === notebookId && learningDraft.content === textToSend;
      const scopedSourceIds = sourceIdsOverride ?? (isLearningDraft ? [learningDraft.sourceId] : undefined);
      if (isLearningDraft) {
        const source = sources?.find((item) => item.id === learningDraft.sourceId);
        if (!source || !isSourceUsableForGroundedChat(source) || isSending || showAiLoading) {
          setMessage(textToSend);
          toast({ title: 'Passage question saved as a draft', description: 'Wait for the source and current response to be ready, then send your question.' });
          return;
        }
      }
      const audioIntent = !scopedSourceIds ? parseStudioAudioIntent(textToSend) : null;
      if (audioIntent) {
        const accepted = useStudioAudioCommands.getState().draft(notebookId, audioIntent, activeSourceId);
        if (accepted) { setMessage(''); setFailedMessage(null); }
        else toast({ title: 'An audio command is already waiting', description: 'Finish or dismiss that command before sending another.' });
        return;
      }
      // Check guest message limit
      if (isGuest && !canSendMessage) {
        showAuthPrompt('send more messages');
        return;
      }

      console.log('📤 Sending message:', textToSend);

      try {
        if (!isToastRetry || failedMessage === textToSend) setFailedMessage(null);
        // Store the pending message to display immediately
        setPendingUserMessage(textToSend);
        const preserveDraft = isToastRetry && message.trim() !== textToSend;
        if (!preserveDraft) setMessage('');

        // Show AI loading immediately
        setShowAiLoading(true);

        // Use sendMessageAsync to properly await the response
        await sendMessageAsync({
          notebookId: notebookId,
          role: 'user',
          content: withAudiobookReadingContext(textToSend, usableReadingContext),
          responseStyle,
          sourceIds: resolveChatSourceIds({
            explicitSourceIds: scopedSourceIds,
            chatScope,
            activeSourceId,
            hasExplicitAllScope,
            readingSourceId: readingContext?.sourceId,
            readingSourceUsable,
          }),
        });

        // Track guest usage
        if (isGuest) {
          incrementUsage('messages', notebookId);
        }

        console.log('✅ Message sent successfully');

        // Clear pending message, draft, and loading state after response
        setPendingUserMessage(null);
        if (!isToastRetry || failedMessage === textToSend) setFailedMessage(null);
        setShowAiLoading(false);
        if (learningDraftRef.current === learningDraft) learningDraftRef.current = null;
      } catch (error) {
        console.error('❌ Failed to send message:', error);
        // A newer passage or notebook draft takes precedence over this failed request.
        if (learningDraftRef.current === learningDraft && (!isToastRetry || message.trim() === textToSend)) {
          // Keep app-generated listening/reader context in the request for retry,
          // but show only the learner's question in the composer.
          setMessage(getVisibleChatQuestion(textToSend));
          setFailedMessage(textToSend);
        }
        setPendingUserMessage(null);
        setShowAiLoading(false);
      }
    }
  }, [
    activeSourceId,
    canSendMessage,
    chatScope,
    hasExplicitAllScope,
    failedMessage,
    incrementUsage,
    isGuest,
    isSending,
    message,
    notebookId,
    responseStyle,
    readingContext,
    readingSourceUsable,
    usableReadingContext,
    sendMessageAsync,
    showAuthPrompt,
    showAiLoading,
    sources,
    toast,
  ]);

  useEffect(() => {
    retryHandlerRef.current = (request) => {
      if (request.notebookId !== notebookId || request.role !== 'user' || !failedMessage) return;
      if (withAudiobookReadingContext(failedMessage, usableReadingContext) !== request.content) return;
      void handleSendMessage(failedMessage, request.sourceIds, true);
    };
    return () => { retryHandlerRef.current = null; };
  }, [failedMessage, handleSendMessage, notebookId, usableReadingContext]);

  const handleAudioListeningQuestion = useCallback((request: AudioListeningQuestionRequest) => {
    if (!notebookId || request.notebookId !== notebookId) return;
    const requestedSource = sources?.find((source) => source.id === request.sourceId);
    const questionMessage = buildAudioListeningQuestionMessage(request);
    clearQueuedAudioListeningQuestion(notebookId);
    setChatMode('study');
    setChatScope('all');
    setHasExplicitAllScope(false);

    if (!requestedSource || !isSourceUsableForGroundedChat(requestedSource)) {
      setMessage(questionMessage);
      toast({
        title: 'Audio question is ready',
        description: 'The source is still processing, so StudyPod kept your question as a draft instead of sending it ungrounded.',
      });
      return;
    }

    void handleSendMessage(questionMessage, [request.sourceId]);
  }, [handleSendMessage, notebookId, sources, toast]);

  useEffect(() => {
    if (!notebookId) return;

    const queued = consumeQueuedAudioListeningQuestion(notebookId);
    if (queued) handleAudioListeningQuestion(queued);

    const onAudioQuestion = (event: Event) => {
      const request = (event as CustomEvent<AudioListeningQuestionRequest>).detail;
      if (!request || request.notebookId !== notebookId) return;
      handleAudioListeningQuestion(request);
    };

    window.addEventListener(AUDIO_LISTENING_QUESTION_EVENT, onAudioQuestion);
    return () => window.removeEventListener(AUDIO_LISTENING_QUESTION_EVENT, onAudioQuestion);
  }, [handleAudioListeningQuestion, notebookId]);

  const handleSourceLearningQuestion = useCallback((request: SourceLearningQuestionRequest) => {
    if (!notebookId || !claimSourceLearningQuestion(request, notebookId)) return;
    const question = buildSourceLearningQuestionMessage(request);
    learningDraftRef.current = { notebookId, content: question, sourceId: request.sourceId };
    setChatMode('study');
    setChatScope('all');
    setHasExplicitAllScope(false);
    const source = sources?.find((item) => item.id === request.sourceId);
    if (!source || !isSourceUsableForGroundedChat(source) || isSending || showAiLoading || learningRequestInFlight.current || (isGuest && !canSendMessage)) {
      setMessage(question);
      toast({ title: 'Passage question saved as a draft', description: 'Your selected passage is kept here. Send it when the source and chat are ready.' });
      return;
    }
    learningRequestInFlight.current = true;
    void handleSendMessage(question, [request.sourceId]).finally(() => { learningRequestInFlight.current = false; });
  }, [canSendMessage, handleSendMessage, isGuest, isSending, notebookId, showAiLoading, sources, toast]);

  useEffect(() => {
    if (!notebookId) return;
    const onLearningQuestion = (event: Event) => {
      const request = (event as CustomEvent<SourceLearningQuestionRequest>).detail;
      if (request) handleSourceLearningQuestion(request);
    };
    window.addEventListener(SOURCE_LEARNING_QUESTION_EVENT, onLearningQuestion);
    const queued = consumeQueuedSourceLearningQuestion(notebookId);
    if (queued) handleSourceLearningQuestion(queued);
    return () => window.removeEventListener(SOURCE_LEARNING_QUESTION_EVENT, onLearningQuestion);
  }, [handleSourceLearningQuestion, notebookId]);

  const handleRefreshChat = () => {
    if (notebookId) {
      console.log('Refresh button clicked for notebook:', notebookId);
      deleteChatHistory(notebookId);
      // Reset clicked questions when chat is refreshed
      setClickedQuestions(new Set());
    }
  };

  const handleShareNotebook = () => {
    if (notebook?.joinCode || notebook?.join_code) {
      const code = notebook.joinCode || notebook.join_code;
      navigator.clipboard.writeText(code);
      toast({
        title: "Join code copied!",
        description: `Code ${code} copied to clipboard. Share it with your teammate!`,
      });
      setIsShareOpen(true);
    }
  };
  const handleCitationClick = (citation: Citation) => {
    onCitationClick?.(citation);
  };
  const handleExampleQuestionClick = (question: string) => {
    // Add question to clicked set to remove it from display
    setClickedQuestions(prev => new Set(prev).add(question));
    setMessage(question);
    handleSendMessage(question);
  };

  // Helper function to determine if message is from user
  const isUserMessage = (msg: EnhancedChatMessage) => {
    const messageType = msg.message?.type;
    return messageType === 'human';
  };

  // Helper function to determine if message is from AI
  const isAiMessage = (msg: EnhancedChatMessage) => {
    const messageType = msg.message?.type;
    return messageType === 'ai';
  };

  // Get the index of the last message for auto-scrolling
  const shouldShowScrollTarget = () => {
    return messages.length > 0 || pendingUserMessage || showAiLoading || failedMessage;
  };

  // Show refresh button if there are any messages (including system messages)
  const shouldShowRefreshButton = messages.length > 0;

  // Agent-specific collaboration prompts from the Sovereign Immersion library
  const getAgentPrompts = () => {
    return IMMERSIVE_PROMPTS.flatMap(category => 
      category.prompts.map(prompt => ({
        text: prompt,
        category: category.label
      }))
    );
  };

  const agentPrompts = getAgentPrompts();

  const hasOnlyTweets = sources && sources.length > 0 && sources.every(s => s.type === 'tweet');

  // Get example questions from the notebook, filtering out clicked ones
  const exampleQuestions = chatMode === 'agent' 
    ? agentPrompts
        .filter(p => !clickedQuestions.has(p.text))
        .map(p => p.text)
    : (hasOnlyTweets
        ? BOOKMARK_PROMPTS.filter(q => !clickedQuestions.has(q))
        : (notebook?.example_questions?.filter(q => !clickedQuestions.has(q)) || [])
      );

  // Keep useful next-step prompts available after the first exchange, when
  // notebook starter questions have already been used or dismissed.
  const contextualFollowUps = usableReadingContext
    ? getReadingFollowUpPrompts(usableReadingContext)
    : CHAT_FOLLOW_UP_PROMPTS;
  const followUpQuestions = contextualFollowUps.filter((question) => !clickedQuestions.has(question));

  // Update placeholder text based on processing status
  const getPlaceholderText = () => {
    if (isChatDisabled) {
      if (sourceCount === 0) {
        return "Add a source to get started...";
      } else if (hasProcessingSource) {
        return "Sources are still processing...";
      } else if (hasFailedSource) {
        return "Source extraction failed. Add or retry a source to chat.";
      } else if (hasMetadataOnlySource) {
        return "This YouTube source has metadata only. Add a transcript-backed source to chat.";
      } else {
        return "Add a ready source to chat...";
      }
    }
    // Show remaining messages for guests
    if (isGuest) {
      return chatMode === 'agent' 
        ? `Collaborate with Agent... (${messagesRemaining} msgs)`
        : `Start typing... (${messagesRemaining} msgs)`;
    }
    if (chatScope === 'active' && activeSource) {
      return `Ask only ${activeSource.title}...`;
    }
    return chatMode === 'agent' ? "Ask your agent to analyze this notebook..." : "Start typing...";
  };
  return <div className="flex-1 flex flex-col h-full overflow-hidden">
      {!hasSource && sourceCount === 0 && sourcesLoading ? (
        <div role="status" className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground">Loading sources...</div>
      ) : !hasSource && sourceCount === 0 && sourcesError ? (
        <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Could not load sources</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Your source list is unavailable. Retry to continue your grounded chat.</p>
          <Button type="button" disabled={sourcesFetching} onClick={() => void retrySources()}>
            {sourcesFetching ? 'Retrying…' : 'Retry loading sources'}
          </Button>
        </div>
      ) : hasSource ? <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Chat Header */}
          <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0 bg-background dark:bg-background">
            <div className="max-w-4xl mx-auto">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="contents sm:flex sm:items-center sm:gap-4">
                <h2 className="basis-full text-lg font-medium text-gray-900 dark:text-foreground sm:basis-auto">
                  {chatMode === 'agent' ? 'Agent Collaboration' : 'Study Chat'}
                </h2>
                <div className="flex bg-muted p-1 rounded-md">
                  <button 
                    onClick={() => setChatMode('study')}
                    aria-pressed={chatMode === 'study'}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors ${chatMode === 'study' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Study
                  </button>
                  <button 
                    onClick={() => setChatMode('agent')}
                    aria-pressed={chatMode === 'agent'}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1 ${chatMode === 'agent' ? 'bg-primary/10 text-primary shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Agent</span>
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
               <div className="hidden md:block">
                  <ChatEvidenceScope
                    value={chatScope}
                    onChange={(scope) => { setChatScope(scope); setHasExplicitAllScope(scope === 'all'); }}
                    activeSourceTitle={activeSource?.title}
                    activeSourceUsable={activeSourceUsable}
                  />
                </div>

                {/* Response Style Toggle */}
                <div className="flex bg-muted p-1 rounded-md">
                  <button
                    onClick={() => setResponseStyle('dense')}
                    aria-label="Detailed responses"
                    aria-pressed={responseStyle === 'dense'}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${responseStyle === 'dense' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Detailed, structured responses with headings and tables"
                  >
                    <List className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Detailed</span>
                  </button>
                  <button
                    onClick={() => setResponseStyle('conversational')}
                    aria-label="Conversational responses"
                    aria-pressed={responseStyle === 'conversational'}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${responseStyle === 'conversational' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Fluid, conversational summaries in plain paragraphs"
                  >
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Conversational</span>
                  </button>
                </div>

                {shouldShowRefreshButton && <Button variant="ghost" size="sm" onClick={handleRefreshChat} disabled={isDeletingChatHistory || isChatDisabled} className="hidden sm:flex items-center space-x-2">
                    <RefreshCw className={`h-4 w-4 ${isDeletingChatHistory ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>{isDeletingChatHistory ? 'Clearing...' : 'Clear Chat'}</span>
                  </Button>}
                {(notebook?.joinCode || notebook?.join_code) && (
                  <Button variant="outline" size="sm" onClick={handleShareNotebook} className="hidden sm:flex items-center space-x-2 border-gray-300 hover:bg-muted text-foreground">
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    <span>Share</span>
                  </Button>
                )}
               <Button variant="outline" size="sm" onClick={() => setShowResearchDialog(true)} className="hidden sm:flex items-center space-x-2">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>Research Further</span>
                </Button>
              </div>
              </div>
              <div className="mt-3 md:hidden">
                <ChatEvidenceScope
                  value={chatScope}
                  onChange={(scope) => { setChatScope(scope); setHasExplicitAllScope(scope === 'all'); }}
                  activeSourceTitle={activeSource?.title}
                  activeSourceUsable={activeSourceUsable}
                />
              </div>
            </div>
          </div>

          {sourcesError && sourceCount > 0 && (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              <span>Could not refresh sources. Showing the last loaded list.</span>
              <Button type="button" variant="outline" size="sm" disabled={sourcesFetching} onClick={() => void retrySources()}>
                {sourcesFetching ? 'Retrying…' : 'Retry loading sources'}
              </Button>
            </div>
          )}
          <ScrollArea className="flex-1 h-full bg-background dark:bg-background" ref={scrollAreaRef}>
             {/* Notebook context stays compact once the conversation begins. */}
             <div className="border-b border-border bg-background/95 dark:bg-background/95 px-5 py-4 sm:px-8">
               <div className="mx-auto max-w-4xl">
                 <div className="flex items-center gap-3">
                   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                     {isGenerating ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /> : <span>{notebook?.icon || '☕'}</span>}
                   </div>
                   <div className="min-w-0 flex-1">
                     <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                       {isGenerating ? 'Preparing your notebook…' : formatDisplayTitle(notebook?.title, 'Untitled notebook')}
                     </h1>
                     <p className="mt-0.5 text-xs text-muted-foreground">
                       {sourceCount} source{sourceCount !== 1 ? 's' : ''}{hasConversation ? ' · conversation in progress' : ''}
                     </p>
                   </div>
                 </div>

                 {!hasConversation && (
                   <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground shadow-sm">
                     {isGenerating ? (
                       <p>StudyPod is reading your source and preparing an overview.</p>
                     ) : (
                       <MarkdownRenderer
                         content={notebook?.description || 'Your sources are ready. Ask a question or choose a starting point below.'}
                         className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert"
                       />
                     )}
                   </div>
                 )}
               </div>
             </div>

             {!hasConversation && (
               <SovereignChatIntro onPromptClick={handleExampleQuestionClick} />
             )}

             <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
               {/* Chat Messages */}
                {(messages.length > 0 || pendingUserMessage || showAiLoading || failedMessage) && <div className="mb-6 space-y-4">
                    {messages.map((msg) => <div key={msg.id} className={`group flex ${isUserMessage(msg) ? 'justify-end' : 'justify-start'}`}>
                        <div className={`${isUserMessage(msg) ? 'max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg' : 'w-full'}`}>
                          <div className={isUserMessage(msg) ? '' : 'prose prose-gray dark:prose-invert max-w-none text-gray-800 dark:text-gray-200'}>
                            <MarkdownRenderer content={isUserMessage(msg) && typeof msg.message.content === 'string' ? getVisibleChatQuestion(msg.message.content) : msg.message.content} className={isUserMessage(msg) ? '' : ''} onCitationClick={handleCitationClick} isUserMessage={isUserMessage(msg)} />
                          </div>
                          {isAiMessage(msg) && <div className="mt-2 flex justify-start">
                              <CaptureButtons content={msg.message.content} notebookId={notebookId} />
                            </div>}
                        </div>
                      </div>)}
                    
                    {/* Pending user message */}
                    {pendingUserMessage && <div className="flex justify-end">
                        <div className="max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg">
                          <MarkdownRenderer content={getVisibleChatQuestion(pendingUserMessage)} className="" isUserMessage={true} />
                        </div>
                      </div>}
                    
                    {/* AI Loading Indicator */}
                    {showAiLoading && <div className="flex justify-start" ref={latestMessageRef}>
                        <div className="flex items-center space-x-2 px-4 py-3 bg-muted rounded-lg">
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{
                    animationDelay: '0.1s'
                  }}></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{
                    animationDelay: '0.2s'
                  }}></div>
                        </div>
                      </div>}
                    
                    {failedMessage && !pendingUserMessage && !showAiLoading && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium">Message not sent</p>
                            <p className="mt-1 text-xs opacity-80">Your draft was restored. Retry without retyping it.</p>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setFailedMessage(null)}>
                              Dismiss
                            </Button>
                            <Button size="sm" onClick={() => handleSendMessage(failedMessage)} disabled={isSending}>
                              Retry
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Scroll target for when no AI loading is shown */}
                    {!showAiLoading && shouldShowScrollTarget() && <div ref={latestMessageRef} />}
                  </div>}
             </div>
          </ScrollArea>

          {notebookId && <StudioAudioCommandCard notebookId={notebookId} sources={sources || []} />}
          {/* Chat Input - Fixed at bottom */}
          <ChatInput 
            message={message}
            onMessageChange={handleMessageChange}
            onSend={() => handleSendMessage()}
            disabled={isChatDisabled}
            isLoading={isSending || !!pendingUserMessage}
            sourceCount={sourceCount}
            exampleQuestions={hasConversation ? followUpQuestions : exampleQuestions}
            onExampleQuestionClick={handleExampleQuestionClick}
            placeholder={getPlaceholderText()}
          />
        </div> :
    // Empty State
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden bg-background dark:bg-background">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-gray-100 dark:bg-muted">
              <i className="fi fi-rr-upload h-8 w-8 text-slate-600 dark:text-slate-400"></i>
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-foreground mb-2">Add a source to get started</h2>
            <p className="mb-4 text-sm text-muted-foreground">Add a file, paste text, or share a link, then ask questions about it.</p>
            <Button onClick={() => setShowAddSourcesDialog(true)}>
              <i className="fi fi-rr-upload h-4 w-4 mr-2"></i>
              Add a source
            </Button>
          </div>

          {/* Bottom Input */}
          <div className="w-full max-w-2xl">
            <div className="flex gap-2 sm:gap-4">
              <Input aria-label="Chat message" value={message} placeholder="Add a source to get started" disabled className="min-w-0 flex-1 h-11 sm:h-10" />
              <div className="flex shrink-0 items-center text-sm text-gray-500">
                0 sources
              </div>
              <Button disabled aria-label="Send message" className="h-11 min-w-11 shrink-0 sm:h-10">
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>}
      
      {/* Footer */}
      <div className="p-4 border-t border-border flex-shrink-0 bg-background dark:bg-background">
        <p className="pr-16 text-center text-xs text-[#53676A] dark:text-[#B8CBC9] sm:pr-0 sm:text-sm">StudyPod can be inaccurate; please double-check its responses.</p>
      </div>
      
      {/* Add Sources Dialog */}
      {showAddSourcesDialog && (
          <AddSourcesDialog open={showAddSourcesDialog} onOpenChange={setShowAddSourcesDialog} notebookId={notebookId} />
      )}
      
      {/* Research Further Dialog */}
      {showResearchDialog && (
        <Suspense fallback={<DialogLoading />}>
          <ResearchFurtherDialog open={showResearchDialog} onOpenChange={setShowResearchDialog} notebookId={notebookId} />
        </Suspense>
      )}

      {/* Share Dialog */}
      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-card border border-border rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium text-foreground">Share Research Package</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Invite your teammates to collaborate. Share this notebook and let them ask their own questions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex flex-col items-center justify-center bg-gray-50 dark:bg-muted/50 p-6 rounded-2xl border border-gray-100 dark:border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Join Code</span>
              <span className="text-3xl font-mono font-bold tracking-widest text-primary uppercase select-all">
                {notebook?.joinCode || notebook?.join_code}
              </span>
            </div>
            <div className="text-xs text-muted-foreground text-center bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 p-3 rounded-xl">
              💡 Your teammates can enter this code in the <strong>"Join notebook"</strong> button on their dashboard to instantly clone/access this package of sources and notes.
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setIsShareOpen(false)} className="bg-black hover:bg-gray-800 text-white rounded-xl px-6">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};

export default ChatArea;
