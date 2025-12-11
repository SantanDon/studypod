/**
 * Podcast Generation Store
 * Persists generation state globally so it continues when switching tabs/features
 * 
 * SIMPLIFIED VERSION - avoids complex selectors that cause infinite loops
 */

import { create } from 'zustand';
import { PodcastScript } from '@/lib/podcastGenerator';
import {
  getStreamingTTSGenerator,
  StreamingProgress,
} from '@/lib/tts/streamingTTSGenerator';

interface PodcastGenerationState {
  // Generation state
  isGenerating: boolean;
  progress: StreamingProgress | null;
  script: PodcastScript | null;
  
  // Audio state
  audioUrl: string | null;
  partialAudioUrls: string[];
  canPlayPartial: boolean;
  
  // Notebook context
  notebookId: string | null;
  
  // Actions
  startGeneration: (notebookId: string, script: PodcastScript) => void;
  updateProgress: (progress: StreamingProgress) => void;
  setAudioReady: (audioUrls: string[]) => void;
  setFinalAudio: (audioUrl: string) => void;
  cancelGeneration: () => void;
  reset: () => void;
}

export const usePodcastGenerationStore = create<PodcastGenerationState>((set, get) => ({
  // Initial state
  isGenerating: false,
  progress: null,
  script: null,
  audioUrl: null,
  partialAudioUrls: [],
  canPlayPartial: false,
  notebookId: null,

  // Start generation
  startGeneration: (notebookId, script) => {
    set({
      isGenerating: true,
      notebookId,
      script,
      audioUrl: null,
      partialAudioUrls: [],
      canPlayPartial: false,
      progress: {
        phase: 'loading',
        currentSegment: 0,
        totalSegments: script.segments.length,
        percentage: 0,
        message: 'Starting generation...',
        canPlay: false,
      },
    });
  },

  // Update progress
  updateProgress: (progress) => {
    set({
      progress,
      canPlayPartial: progress.canPlay,
    });

    // Check if complete or cancelled
    if (progress.phase === 'complete' || progress.phase === 'cancelled' || progress.phase === 'error') {
      set({ isGenerating: false });
    }
  },

  // Set partial audio URLs as they become available
  setAudioReady: (audioUrls) => {
    set({
      partialAudioUrls: audioUrls,
      canPlayPartial: audioUrls.length > 0,
    });
  },

  // Set final combined audio
  setFinalAudio: (audioUrl) => {
    set({
      audioUrl,
      isGenerating: false,
    });
  },

  // Cancel generation
  cancelGeneration: () => {
    const generator = getStreamingTTSGenerator();
    generator.cancel();
    set({
      isGenerating: false,
      progress: {
        phase: 'cancelled',
        currentSegment: 0,
        totalSegments: 0,
        percentage: 0,
        message: 'Generation cancelled',
        canPlay: get().partialAudioUrls.length > 0,
      },
    });
  },

  // Reset state
  reset: () => {
    set({
      isGenerating: false,
      progress: null,
      script: null,
      audioUrl: null,
      partialAudioUrls: [],
      canPlayPartial: false,
      notebookId: null,
    });
  },
}));

/**
 * Hook to check if generation is running for a specific notebook
 */
export function useIsGeneratingForNotebook(notebookId: string): boolean {
  return usePodcastGenerationStore(
    (state) => state.isGenerating && state.notebookId === notebookId
  );
}

/**
 * Individual selectors to avoid object creation in render
 * These return primitive values or stable references
 */
export function usePodcastIsGenerating(notebookId: string): boolean {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const isGenerating = usePodcastGenerationStore((state) => state.isGenerating);
  return isGenerating && storeNotebookId === notebookId;
}

export function usePodcastProgress(notebookId: string): StreamingProgress | null {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const progress = usePodcastGenerationStore((state) => state.progress);
  return storeNotebookId === notebookId ? progress : null;
}

export function usePodcastScript(notebookId: string): PodcastScript | null {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const script = usePodcastGenerationStore((state) => state.script);
  return storeNotebookId === notebookId ? script : null;
}

export function usePodcastAudioUrl(notebookId: string): string | null {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const audioUrl = usePodcastGenerationStore((state) => state.audioUrl);
  return storeNotebookId === notebookId ? audioUrl : null;
}

export function usePodcastPartialUrls(notebookId: string): string[] {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const partialAudioUrls = usePodcastGenerationStore((state) => state.partialAudioUrls);
  return storeNotebookId === notebookId ? partialAudioUrls : [];
}

export function usePodcastCanPlayPartial(notebookId: string): boolean {
  const storeNotebookId = usePodcastGenerationStore((state) => state.notebookId);
  const canPlayPartial = usePodcastGenerationStore((state) => state.canPlayPartial);
  return storeNotebookId === notebookId && canPlayPartial;
}
