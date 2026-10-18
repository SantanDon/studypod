import { OPEN_STUDIO_AUDIO_EVENT } from '@/lib/audio/studioAudioCommands';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import { FileText, MessageCircle, NotebookPen } from 'lucide-react'; // Removed Lucide imports
import SourcesSidebar from './SourcesSidebar';
import ChatArea from './ChatArea';
import { Citation } from '@/types/message';
import {
  AUDIO_LISTENING_QUESTION_EVENT,
  type AudioListeningQuestionRequest,
} from '@/lib/audio/listeningQuestion';

const StudioSidebar = lazy(() => import('./StudioSidebar'));

const StudioLoading = () => (
  <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    Loading Studio…
  </div>
);

interface MobileNotebookTabsProps {
  hasSource: boolean;
  notebookId?: string;
  notebook?: {
    id: string;
    title: string;
    description?: string;
    generation_status?: string;
    icon?: string;
    example_questions?: string[];
  } | null;
  selectedCitation?: Citation | null;
  onCitationClose?: () => void;
  setSelectedCitation?: (citation: Citation | null) => void;
  onCitationClick?: (citation: Citation) => void;
  activeSourceId?: string | null;
  onActiveSourceChange?: (sourceId: string | null) => void;
}

const MobileNotebookTabs = ({
  hasSource,
  notebookId,
  notebook,
  selectedCitation,
  onCitationClose,
  setSelectedCitation,
  onCitationClick,
  activeSourceId,
  onActiveSourceChange,
}: MobileNotebookTabsProps) => {
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('view') === 'studio' ? 'studio' : 'chat');
  const [citationOrigin, setCitationOrigin] = useState<'chat' | 'studio' | null>(null);
  const citationTriggerRef = useRef<HTMLElement | null>(null);
  const chatTabRef = useRef<HTMLButtonElement>(null);
  const studioTabRef = useRef<HTMLButtonElement>(null);

  const openCitation = (citation: Citation, origin: 'chat' | 'studio') => {
    citationTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCitationOrigin(origin);
    onCitationClick?.(citation);
    setActiveTab('sources');
  };

  const closeCitation = () => {
    setCitationOrigin(null);
    onCitationClose?.();
  };

  const returnToCitationOrigin = () => {
    if (citationOrigin) {
      const origin = citationOrigin;
      setActiveTab(origin);
      requestAnimationFrame(() => {
        const trigger = citationTriggerRef.current;
        if (trigger?.isConnected && !trigger.closest('[data-state="inactive"]')) trigger.focus();
        else (origin === 'chat' ? chatTabRef : studioTabRef).current?.focus();
        citationTriggerRef.current = null;
      });
    }
    setCitationOrigin(null);
  };

  useEffect(() => {
    const onAudioQuestion = (event: Event) => {
      const request = (event as CustomEvent<AudioListeningQuestionRequest>).detail;
      if (request?.notebookId === notebookId) setActiveTab('chat');
    };
    const onAudioTool = (event: Event) => {
      if ((event as CustomEvent<{ notebookId?: string }>).detail?.notebookId === notebookId) setActiveTab('studio');
    };
    window.addEventListener(AUDIO_LISTENING_QUESTION_EVENT, onAudioQuestion);
    window.addEventListener(OPEN_STUDIO_AUDIO_EVENT, onAudioTool);
    return () => {
      window.removeEventListener(AUDIO_LISTENING_QUESTION_EVENT, onAudioQuestion);
      window.removeEventListener(OPEN_STUDIO_AUDIO_EVENT, onAudioTool);
    };
  }, [notebookId]);
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
      <TabsList className="grid w-full grid-cols-3 bg-gray-100 dark:bg-muted p-1 h-12 rounded-none border-b border-gray-200 dark:border-border">
        <TabsTrigger 
          value="sources" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
        >
          <i aria-hidden="true" className="fi fi-rr-file h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Sources</span>
        </TabsTrigger>
        <TabsTrigger 
          ref={chatTabRef}
          value="chat" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
        >
          <i aria-hidden="true" className="fi fi-rr-comment h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Chat</span>
        </TabsTrigger>
        <TabsTrigger 
          ref={studioTabRef}
          value="studio" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
          data-testid="mobile-studio-tab"
        >
          <i aria-hidden="true" className="fi fi-rr-notebook h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Studio</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sources" className="flex-1 overflow-hidden mt-0">
        <SourcesSidebar
          hasSource={hasSource}
          notebookId={notebookId}
          selectedCitation={selectedCitation}
          onCitationClose={closeCitation}
          setSelectedCitation={setSelectedCitation}
          activeSourceId={activeSourceId}
          onActiveSourceChange={onActiveSourceChange}
          returnToCitationOrigin={selectedCitation && citationOrigin ? citationOrigin : null}
          onReturnToCitationOrigin={returnToCitationOrigin}
        />
      </TabsContent>

      <TabsContent value="chat" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
        <ChatArea 
          hasSource={hasSource}
          notebookId={notebookId}
          notebook={notebook}
          activeSourceId={activeSourceId}
          onCitationClick={(citation) => openCitation(citation, 'chat')}
        />
      </TabsContent>

      <TabsContent value="studio" className="flex-1 overflow-hidden mt-0">
        <Suspense fallback={<StudioLoading />}>
          <StudioSidebar
            notebookId={notebookId}
            onCitationClick={(citation) => openCitation(citation, 'studio')}
            activeSourceId={activeSourceId}
          />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
};

export default MobileNotebookTabs;
