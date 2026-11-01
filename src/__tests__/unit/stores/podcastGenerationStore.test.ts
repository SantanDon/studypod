import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generator = vi.hoisted(() => ({
  isRunning: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock("@/lib/tts/streamingTTSGenerator", () => ({
  getStreamingTTSGenerator: vi.fn(() => generator),
}));

const { usePodcastGenerationStore, usePodcastId, usePodcastProgress } =
  await import("@/stores/podcastGenerationStore");

const script = {
  title: "Evidence briefing",
  segments: [{ speaker: "Alex", text: "A grounded introduction." }],
};

describe("podcast generation identity persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      usePodcastGenerationStore.getState().reset();
    });
  });

  it("keeps the durable history ID with the global audio state across view remounts", () => {
    act(() => {
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
      usePodcastGenerationStore
        .getState()
        .setFinalAudio(
          "blob:episode-audio",
          "notebook-1",
          "Evidence briefing",
          "podcast-history-1",
        );
    });

    const firstMount = renderHook(() => usePodcastId("notebook-1"));
    expect(firstMount.result.current).toBe("podcast-history-1");
    firstMount.unmount();

    const secondMount = renderHook(() => usePodcastId("notebook-1"));
    expect(secondMount.result.current).toBe("podcast-history-1");
    expect(usePodcastGenerationStore.getState()).toMatchObject({
      audioUrl: "blob:episode-audio",
      podcastId: "podcast-history-1",
      notebookId: "notebook-1",
    });
  });

  it("clears an old history ID when a new generation starts", () => {
    act(() => {
      usePodcastGenerationStore.setState({
        podcastId: "old-podcast",
        audioUrl: "blob:old",
        notebookId: "notebook-1",
      });
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
    });

    expect(usePodcastGenerationStore.getState().podcastId).toBeNull();
    expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
  });

  it("keeps finalization ownership and source scope in the store across view remounts", () => {
    act(() => {
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script, {
        sourceIds: ["source-a", "source-b"],
      });
    });

    // The remounted view receives the same run script and must not start a second save.
    expect(usePodcastGenerationStore.getState().sourceIds).toEqual(["source-a", "source-b"]);
    expect(usePodcastGenerationStore.getState().claimFinalization(script)).toBe(true);
    expect(usePodcastGenerationStore.getState().claimFinalization(script)).toBe(false);

    act(() => usePodcastGenerationStore.getState().cancelGeneration());
    expect(usePodcastGenerationStore.getState()).toMatchObject({
      isGenerating: false,
      finalizingScript: null,
      sourceIds: [],
    });
  });

  it("does not expose one notebook podcast ID in another notebook", () => {
    act(() => {
      usePodcastGenerationStore.setState({
        podcastId: "podcast-history-1",
        notebookId: "notebook-1",
      });
    });

    const { result } = renderHook(() => usePodcastId("notebook-2"));
    expect(result.current).toBeNull();
  });

  it("keeps browser speech playback explicitly non-downloadable and out of saved history", () => {
    act(() => {
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script);
      usePodcastGenerationStore.getState().setAudioReady(["blob:script-segment"]);
      usePodcastGenerationStore.getState().setFinalAudio(
        "webspeech_fallback",
        "notebook-1",
        script.title,
      );
    });

    expect(usePodcastGenerationStore.getState()).toMatchObject({
      audioUrl: "webspeech_fallback",
      podcastId: null,
      notebookId: "notebook-1",
      isGenerating: false,
      canPlayPartial: true,
    });
  });

  it("retains a terminal generation error after the generating banner closes", () => {
    act(() => {
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script);
      usePodcastGenerationStore.getState().updateProgress({
        phase: "error",
        currentSegment: 2,
        totalSegments: 4,
        percentage: 50,
        message: "Worker initialization failed",
        canPlay: false,
      });
    });

    const state = usePodcastGenerationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.script).toEqual(script);
    expect(state.progress).toMatchObject({
      phase: "error",
      message: "Worker initialization failed",
      percentage: 50,
    });
    const remountedView = renderHook(() => usePodcastProgress("notebook-1"));
    expect(remountedView.result.current?.phase).toBe("error");
    expect(remountedView.result.current?.message).toBe("Worker initialization failed");
  });
});
