import { createContext } from "react";
import { GuestUsage } from "@/lib/utils/contextUtils";

export interface GuestContextType {
  isGuest: boolean;
  guestId: string | null;
  usage: GuestUsage;
  canCreateNotebook: boolean;
  canAddSource: boolean;
  canSendMessage: boolean;
  canGeneratePodcast: boolean;
  canCreateFlashcards: boolean;
  canCreateQuiz: boolean;
  remainingNotebooks: number;
  remainingSources: number;
  remainingMessages: number;
  incrementUsage: (type: keyof GuestUsage, notebookId?: string) => void;
  getNotebookUsage: (notebookId: string) => { sources: number; messages: number };
  migrateToUser: () => Promise<void>;
  showAuthPrompt: (feature: string) => void;
  authPromptOpen: boolean;
  authPromptFeature: string;
  closeAuthPrompt: () => void;
}

export const GuestContext = createContext<GuestContextType | undefined>(undefined);
