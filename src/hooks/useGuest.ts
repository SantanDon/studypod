import { useContext } from "react";
import { GuestContext } from "@/contexts/GuestContextInstance";
import { GUEST_LIMITS } from "@/lib/utils/contextUtils";

export const useGuest = () => {
  const context = useContext(GuestContext);
  if (context === undefined) {
    throw new Error('useGuest must be used within a GuestProvider');
  }
  return context;
};

// Helper hook for checking specific notebook limits
export const useNotebookLimits = (notebookId: string | undefined) => {
  const { isGuest, getNotebookUsage, showAuthPrompt, canGeneratePodcast, canCreateFlashcards, canCreateQuiz } = useGuest();
  
  if (!isGuest || !notebookId) {
    return {
      canAddSource: true,
      canSendMessage: true,
      canGeneratePodcast: true,
      canCreateFlashcards: true,
      canCreateQuiz: true,
      sourcesUsed: 0,
      messagesUsed: 0,
      sourcesRemaining: Infinity,
      messagesRemaining: Infinity,
    };
  }

  const usage = getNotebookUsage(notebookId);
  const sourcesRemaining = Math.max(0, GUEST_LIMITS.sourcesPerNotebook - usage.sources);
  const messagesRemaining = Math.max(0, GUEST_LIMITS.messagesPerNotebook - usage.messages);

  return {
    canAddSource: sourcesRemaining > 0,
    canSendMessage: messagesRemaining > 0,
    canGeneratePodcast,
    canCreateFlashcards,
    canCreateQuiz,
    sourcesUsed: usage.sources,
    messagesUsed: usage.messages,
    sourcesRemaining,
    messagesRemaining,
    checkSourceLimit: () => {
      if (sourcesRemaining <= 0) {
        showAuthPrompt('add more sources');
        return false;
      }
      return true;
    },
    checkMessageLimit: () => {
      if (messagesRemaining <= 0) {
        showAuthPrompt('send more messages');
        return false;
      }
      return true;
    },
  };
};
