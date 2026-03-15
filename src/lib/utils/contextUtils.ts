/**
 * Component Utility Functions and Constants
 * 
 * This file contains constants and helper functions used in context providers
 * and components to satisfy Fast Refresh requirements.
 */

// Auth Helpers
export const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error(`Failed to read localStorage key "${key}":`, e);
    return null;
  }
};

export const safeParseJSON = <T,>(data: string | null): T | null => {
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    return null;
  }
};

// Guest Mode Constants and Helpers
export const GUEST_LIMITS = {
  notebooks: 3,
  sourcesPerNotebook: 5,
  messagesPerNotebook: 20,
  podcastsPerNotebook: 1,
  flashcardsPerNotebook: 10,
  quizzesPerNotebook: 2,
} as const;

export function generateGuestId(): string {
  return `guest_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export interface GuestUsage {
  notebooks: number;
  sources: number;
  messages: number;
  podcasts: number;
  flashcards: number;
  quizzes: number;
}

export function getInitialUsage(): GuestUsage {
  return {
    notebooks: 0,
    sources: 0,
    messages: 0,
    podcasts: 0,
    flashcards: 0,
    quizzes: 0,
  };
}
