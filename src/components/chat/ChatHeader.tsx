import React from 'react';
import { Button } from '@/components/ui/button';
import { TutorSelector } from '../notebook/TutorSelector';
import { getTutorById } from '@/config/tutors';

/**
 * ChatHeader Component
 * 
 * Displays chat header with title, tutor selector, and action buttons.
 * Shows video chat button for YouTube sources and refresh button for clearing chat.
 * 
 * @component
 * @example
 * ```tsx
 * <ChatHeader
 *   title="Chat"
 *   isStudyMode={false}
 *   selectedTutorId={tutorId}
 *   onTutorSelect={setTutorId}
 *   youtubeSource={source}
 *   onOpenVideoChat={handleVideoChat}
 *   shouldShowRefreshButton={true}
 *   onRefreshChat={handleRefresh}
 *   isDeletingChatHistory={false}
 *   isChatDisabled={false}
 *   isSending={false}
 *   hasPendingMessage={false}
 * />
 * ```
 */
interface ChatHeaderProps {
  title: string;
  isStudyMode: boolean;
  selectedTutorId: string;
  onTutorSelect: (id: string) => void;
  youtubeSource?: { url: string; title: string; sourceId: string } | null;
  onOpenVideoChat?: (source: { url: string; title: string; sourceId: string }) => void;
  shouldShowRefreshButton: boolean;
  onRefreshChat: () => void;
  isDeletingChatHistory: boolean;
  isChatDisabled: boolean;
  isSending: boolean;
  hasPendingMessage: boolean;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  isStudyMode,
  selectedTutorId,
  onTutorSelect,
  youtubeSource,
  onOpenVideoChat,
  shouldShowRefreshButton,
  onRefreshChat,
  isDeletingChatHistory,
  isChatDisabled,
  isSending,
  hasPendingMessage,
}) => {
  return (
    <div
      className={`px-4 py-2 border-b ${
        isStudyMode
          ? 'border-slate-800 bg-slate-950/80'
          : 'border-border bg-background/80'
      } flex-shrink-0 sticky top-0 z-10`}
    >
      <div className="max-w-4xl mx-auto flex flex-col space-y-2">
        <div className="flex items-center justify-between">
          <h2
            className={`text-lg font-bold ${
              isStudyMode ? 'text-slate-100' : 'text-foreground'
            }`}
          >
            {title}
          </h2>
          <div className="flex items-center space-x-4">
            {selectedTutorId !== 'default' && (
              <div
                className={`flex items-center space-x-2 px-3 py-1 ${
                  isStudyMode
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-primary/10 text-primary border-primary/20'
                } rounded-full border animate-in fade-in slide-in-from-top-1`}
              >
                <span className="flex items-center justify-center w-3 h-3">
                  {getTutorById(selectedTutorId).avatarIcon}
                </span>
                <span className="text-[11px] font-medium tracking-tight">
                  Teaching as <b className="font-bold">{getTutorById(selectedTutorId).name}</b>
                </span>
              </div>
            )}
            <div className="flex items-center space-x-2">
              {youtubeSource && onOpenVideoChat && (
                <Button
                  size="sm"
                  onClick={() =>
                    onOpenVideoChat({
                      url: youtubeSource.url || '',
                      title: youtubeSource.title,
                      sourceId: youtubeSource.sourceId,
                    })
                  }
                  className="bg-red-600 hover:bg-red-700 text-white h-8 px-3 text-xs flex items-center space-x-2 shadow-sm"
                >
                  <i className="fi fi-rr-play-circle h-3 w-3"></i>
                  <span className="font-bold">Watch & Chat</span>
                </Button>
              )}
              {shouldShowRefreshButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshChat}
                  disabled={isDeletingChatHistory || isChatDisabled}
                  className="flex items-center space-x-2"
                >
                  <i
                    className={`fi fi-rr-refresh h-4 w-4 ${
                      isDeletingChatHistory ? 'animate-spin' : ''
                    }`}
                  ></i>
                  <span>{isDeletingChatHistory ? 'Clear' : 'Clear Chat'}</span>
                </Button>
              )}
            </div>
          </div>
        </div>
        <TutorSelector
          selectedTutorId={selectedTutorId}
          onTutorSelect={onTutorSelect}
          disabled={isSending || hasPendingMessage}
        />
      </div>
    </div>
  );
};

export default ChatHeader;
