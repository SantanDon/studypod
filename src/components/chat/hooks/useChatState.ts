import { useState, useEffect } from 'react';

/**
 * useChatState Hook
 * 
 * Manages chat UI state including message input, loading states, and focus mode.
 * Handles auto-clearing of pending messages when new messages arrive.
 * 
 * @param initialFocusedSourceId - Initial focused source ID for focus mode
 * @returns Chat state and handlers
 * 
 * @example
 * ```tsx
 * const {
 *   message,
 *   setMessage,
 *   pendingUserMessage,
 *   setPendingUserMessage,
 *   showAiLoading,
 *   setShowAiLoading,
 *   focusedSourceId,
 *   setFocusedSourceId,
 *   isFocusModeActive,
 *   setIsFocusModeActive,
 *   clickedQuestions,
 *   setClickedQuestions,
 *   lastMessageCount,
 *   setLastMessageCount,
 * } = useChatState(initialFocusedSourceId);
 * ```
 */
interface UseChatStateReturn {
  message: string;
  setMessage: (message: string) => void;
  pendingUserMessage: string | null;
  setPendingUserMessage: (message: string | null) => void;
  showAiLoading: boolean;
  setShowAiLoading: (loading: boolean) => void;
  focusedSourceId: string | null;
  setFocusedSourceId: (id: string | null) => void;
  isFocusModeActive: boolean;
  setIsFocusModeActive: (active: boolean) => void;
  clickedQuestions: Set<string>;
  setClickedQuestions: (questions: Set<string>) => void;
  lastMessageCount: number;
  setLastMessageCount: (count: number) => void;
  selectedTutorId: string;
  setSelectedTutorId: (id: string) => void;
}

export function useChatState(
  initialFocusedSourceId?: string | null
): UseChatStateReturn {
  const [message, setMessage] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showAiLoading, setShowAiLoading] = useState(false);
  const [focusedSourceId, setFocusedSourceId] = useState<string | null>(
    initialFocusedSourceId || null
  );
  const [isFocusModeActive, setIsFocusModeActive] = useState(!!initialFocusedSourceId);
  const [clickedQuestions, setClickedQuestions] = useState<Set<string>>(new Set());
  const [lastMessageCount, setLastMessageCount] = useState(0);
  const [selectedTutorId, setSelectedTutorId] = useState('default');

  // Update focus mode when initial focused source changes
  useEffect(() => {
    if (initialFocusedSourceId) {
      setFocusedSourceId(initialFocusedSourceId);
      setIsFocusModeActive(true);
    } else {
      setFocusedSourceId(null);
      setIsFocusModeActive(false);
    }
  }, [initialFocusedSourceId]);

  return {
    message,
    setMessage,
    pendingUserMessage,
    setPendingUserMessage,
    showAiLoading,
    setShowAiLoading,
    focusedSourceId,
    setFocusedSourceId,
    isFocusModeActive,
    setIsFocusModeActive,
    clickedQuestions,
    setClickedQuestions,
    lastMessageCount,
    setLastMessageCount,
    selectedTutorId,
    setSelectedTutorId,
  };
}
