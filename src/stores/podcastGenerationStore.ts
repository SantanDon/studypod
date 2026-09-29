/**
 * Podcast Generation Store
 * Persists generation state globally so it continues when switching tabs/features
 *
 * SIMPLIFIED VERSION - avoids complex selectors that cause infinite loops
 */

import { create } from "zustand";
import { PodcastScript } from "@/lib/podcastGenerator";
import {
  getStreamingTTSGenerator,
  StreamingProgress,
} from "@/lib/tts/streamingTTSGenerator";

interface PodcastGenerationState {
  // Generation state
  isGenerating: boolean;
  progress: StreamingProgress | null;
  script: PodcastScript | null;

  // Customization state
  host1Name: string;
  host2Name: string;
  podcastType: "brief" | "standard" | "deep-dive";
  podcastFormat: "dialogue" | "solo";

  // Audio state
  audioUrl: string | null;
  podcastId: string | null;
  partialAudioUrls: string[];
  canPlayPartial: boolean;

  // Notebook context
  notebookId: string | null;

  // Actions
  startGeneration: (
    notebookId: string,
    script: PodcastScript,
    options?: {
      host1Name?: string;
      host2Name?: string;
      type?: "brief" | "standard" | "deep-dive";
      format?: "dialogue" | "solo";
    },
  ) => void;
  updateProgress: (progress: StreamingProgress) => void;
  setAudioReady: (audioUrls: string[]) => void;
  setFinalAudio: (
    audioUrl: string,
    notebookId?: string,
    title?: string,
    podcastId?: string,
  ) => void;
  saveIntermediateState: () => void;
  rehydrateState: (notebookId: string) => boolean;
  cancelGeneration: () => void;
  reset: () => void;
}

/**
 * Segment URLs are live `blob:` handles. Clearing the array without revoking them leaks
 * every generated segment and leaves the UI offering playback of audio it can no longer read.
 * Revoking an already-revoked URL is a no-op, so this is safe to repeat.
 */
function revokeAudioUrls(urls: readonly string[]): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function")
    return;
  for (const url of urls)
    if (typeof url === "string" && url.startsWith("blob:"))
      URL.revokeObjectURL(url);
}

function isRestorableScript(value: unknown): value is PodcastScript {
  if (!value || typeof value !== 'object') return false;
  const script = value as Record<string, unknown>;
  const metadata = script.metadata;
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const details = metadata as Record<string, unknown>;
    if (typeof details.host1Name !== 'string' || typeof details.host2Name !== 'string' ||
      !['brief', 'standard', 'deep-dive'].includes(String(details.type)) ||
      (details.format !== undefined && details.format !== 'dialogue' && details.format !== 'solo')) return false;
  }
  if (script.estimatedDuration !== undefined &&
    (typeof script.estimatedDuration !== 'number' || !Number.isFinite(script.estimatedDuration) || script.estimatedDuration < 0)) return false;
  return typeof script.title === 'string' && script.title.length <= 1000 &&
    Array.isArray(script.segments) && script.segments.length > 0 && script.segments.length <= 10000 &&
    script.segments.every(segment => segment && typeof segment === 'object' &&
      typeof segment.speaker === 'string' && segment.speaker.length <= 256 && typeof segment.text === 'string' &&
      segment.text.length <= 100000);
}

export const usePodcastGenerationStore = create<PodcastGenerationState>(
  (set, get) => ({
    isGenerating: false,
    progress: null,
    script: null,
    host1Name: "Alex",
    host2Name: "Sarah",
    podcastType: "standard",
    podcastFormat: "dialogue",
    audioUrl: null,
    podcastId: null,
    partialAudioUrls: [],
    canPlayPartial: false,
    notebookId: null,

    // Start generation
    startGeneration: (notebookId, script, options) => {
      revokeAudioUrls(get().partialAudioUrls);
      set({
        isGenerating: true,
        notebookId,
        script,
        host1Name: options?.host1Name || "Alex",
        host2Name: options?.host2Name || "Sarah",
        podcastType: options?.type || "standard",
        podcastFormat: options?.format || "dialogue",
        audioUrl: null,
        podcastId: null,
        partialAudioUrls: [],
        canPlayPartial: false,
        progress: {
          phase: "loading",
          currentSegment: 0,
          totalSegments: script.segments.length,
          percentage: 0,
          message: "Starting generation...",
          canPlay: false,
        },
      });

      // Save initial state to localStorage to prevent loss on refresh
      get().saveIntermediateState();
    },

    // Update progress
    updateProgress: (progress) => {
      set({
        progress,
        canPlayPartial: progress.canPlay,
      });

      // Check if cancelled or error (complete is handled by setFinalAudio to avoid race conditions)
      if (progress.phase === "cancelled" || progress.phase === "error") {
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
    setFinalAudio: (audioUrl, notebookId, title, podcastId) => {
      set((state) => ({
        audioUrl,
        podcastId: podcastId || state.podcastId,
        notebookId: notebookId || state.notebookId,
        isGenerating: false,
        script: title ? { title, segments: [] } : state.script,
      }));
      // Final clear of intermediate state as it's now in history
      localStorage.removeItem(
        `active_podcast_${notebookId || get().notebookId}`,
      );
    },

    // Rehydrate state from localStorage
    /**
     * Rehydrate from localStorage.
     *
     * Cross-reload durable resume is NOT implemented: `partialAudioUrls` are `blob:`
     * handles that die with the document, and the TTS generator is an in-memory
     * singleton that does not survive a reload. So we only reattach to a run that is
     * still genuinely alive in this page. Otherwise the script and settings are
     * restored as an INTERRUPTED DRAFT: not generating, not playable, restartable by
     * the user, with stale audio handles dropped rather than offered as working audio.
     * Returns true only when a live run was actually reattached.
     */
    rehydrateState: (notebookId) => {
      if (!notebookId) return false;
      const saved = localStorage.getItem(`active_podcast_${notebookId}`);
      if (!saved) return false;

      let data: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
        data = parsed as Record<string, unknown>;
      } catch {
        localStorage.removeItem(`active_podcast_${notebookId}`);
        return false;
      }

      const timestamp = data.timestamp;
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
        localStorage.removeItem(`active_podcast_${notebookId}`);
        return false;
      }
      // Only rehydrate if it was recent (within 30 mins)
      if (timestamp > Date.now() + 60_000 || Date.now() - timestamp > 30 * 60 * 1000) {
        localStorage.removeItem(`active_podcast_${notebookId}`);
        return false;
      }
      // Never adopt a payload that belongs to another notebook.
      if (data.notebookId !== notebookId) {
        localStorage.removeItem(`active_podcast_${notebookId}`);
        return false;
      }
      const script = data.script;
      if (!isRestorableScript(script)) {
        localStorage.removeItem(`active_podcast_${notebookId}`);
        return false;
      }

      const generator = getStreamingTTSGenerator();
      const current = get();
      // A reattach is only honest when THIS notebook's own run is still executing here.
      const isLiveReattach =
        generator.isRunning() &&
        current.isGenerating &&
        current.notebookId === notebookId;

      if (isLiveReattach) {
        set({
          progress: {
            phase: "generating",
            currentSegment: current.progress?.currentSegment ?? 0,
            totalSegments: current.script?.segments.length || script.segments.length,
            percentage: Math.min(100, current.progress?.percentage ?? 0),
            message: "Recovering session...",
            // Live in-memory handles only; persisted blob strings are not trusted.
            canPlay: current.partialAudioUrls.length > 0,
          },
          canPlayPartial: current.partialAudioUrls.length > 0,
        });
        return true;
      }

      if (current.isGenerating && current.notebookId !== notebookId) {
        // Another notebook owns the live run: do not replace it with a foreign draft.
        return false;
      }

      // Interrupted draft. Keep the script and settings, drop the unusable audio.
      console.info(
        "🎙️ Restoring an interrupted podcast draft; cross-reload durable resume is not implemented.",
      );
      set({
        isGenerating: false,
        notebookId,
        script,
        audioUrl: null,
        podcastId: null,
        host1Name: typeof data.host1Name === "string" ? data.host1Name : "Alex",
        host2Name: typeof data.host2Name === "string" ? data.host2Name : "Sarah",
        podcastType: data.podcastType === "brief" || data.podcastType === "deep-dive" ? data.podcastType : "standard",
        podcastFormat: data.podcastFormat === "solo" ? "solo" : "dialogue",
        partialAudioUrls: [],
        canPlayPartial: false,
        progress: {
          phase: "error",
          currentSegment: 0,
          totalSegments: script.segments.length,
          percentage: 0,
          message:
            "This podcast was interrupted. Its audio was not saved, so start it again.",
          canPlay: false,
        },
      });
      return false;
    },

    // Save state to localStorage for persistence across reloads/crashes
    saveIntermediateState: () => {
      const state = get();
      if (!state.notebookId || !state.isGenerating) return;

      const data = {
        notebookId: state.notebookId,
        script: state.script,
        host1Name: state.host1Name,
        host2Name: state.host2Name,
        podcastType: state.podcastType,
        podcastFormat: state.podcastFormat,
        // `partialAudioUrls` are deliberately NOT persisted: `blob:` handles do not
        // survive a reload, so writing them would only produce dead audio on return.
        // Only a live in-memory run can supply working audio.
        timestamp: Date.now(),
      };

      localStorage.setItem(
        `active_podcast_${state.notebookId}`,
        JSON.stringify(data),
      );
    },

    // Cancel generation
    cancelGeneration: () => {
      const generator = getStreamingTTSGenerator();
      generator.cancel();
      const currentNotebookId = get().notebookId;
      if (currentNotebookId) {
        localStorage.removeItem(`active_podcast_${currentNotebookId}`);
      }
      // The user abandoned this run: drop its segments instead of leaving a cancelled
      // session's audio offered for playback.
      revokeAudioUrls(get().partialAudioUrls);
      set({
        isGenerating: false,
        partialAudioUrls: [],
        canPlayPartial: false,
        progress: {
          phase: "cancelled",
          currentSegment: 0,
          totalSegments: 0,
          percentage: 0,
          message: "Generation cancelled",
          canPlay: false,
        },
      });
    },

    // Reset state
    reset: () => {
      const currentNotebookId = get().notebookId;
      if (currentNotebookId) {
        localStorage.removeItem(`active_podcast_${currentNotebookId}`);
      }
      revokeAudioUrls(get().partialAudioUrls);
      set({
        isGenerating: false,
        progress: null,
        script: null,
        audioUrl: null,
        podcastId: null,
        partialAudioUrls: [],
        canPlayPartial: false,
        notebookId: null,
      });
    },
  }),
);

/**
 * Hook to check if generation is running for a specific notebook
 */
export function useIsGeneratingForNotebook(notebookId: string): boolean {
  return usePodcastGenerationStore(
    (state) => state.isGenerating && state.notebookId === notebookId,
  );
}

/**
 * Individual selectors to avoid object creation in render
 * These return primitive values or stable references
 */
export function usePodcastIsGenerating(notebookId: string): boolean {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const isGenerating = usePodcastGenerationStore((state) => state.isGenerating);
  return isGenerating && storeNotebookId === notebookId;
}

export function usePodcastProgress(
  notebookId: string,
): StreamingProgress | null {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const progress = usePodcastGenerationStore((state) => state.progress);
  return storeNotebookId === notebookId ? progress : null;
}

export function usePodcastScript(notebookId: string): PodcastScript | null {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const script = usePodcastGenerationStore((state) => state.script);
  return storeNotebookId === notebookId ? script : null;
}

export function usePodcastAudioUrl(notebookId: string): string | null {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const audioUrl = usePodcastGenerationStore((state) => state.audioUrl);
  return storeNotebookId === notebookId ? audioUrl : null;
}

export function usePodcastId(notebookId: string): string | null {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const podcastId = usePodcastGenerationStore((state) => state.podcastId);
  return storeNotebookId === notebookId ? podcastId : null;
}

export function usePodcastPartialUrls(notebookId: string): string[] {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const partialAudioUrls = usePodcastGenerationStore(
    (state) => state.partialAudioUrls,
  );
  return storeNotebookId === notebookId ? partialAudioUrls : [];
}

export function usePodcastCanPlayPartial(notebookId: string): boolean {
  const storeNotebookId = usePodcastGenerationStore(
    (state) => state.notebookId,
  );
  const canPlayPartial = usePodcastGenerationStore(
    (state) => state.canPlayPartial,
  );
  return storeNotebookId === notebookId && canPlayPartial;
}
