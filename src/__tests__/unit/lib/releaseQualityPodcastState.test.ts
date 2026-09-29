/**
 * Release-quality guards for the podcast generation store.
 *
 * Provider honesty: the streaming TTS generator is MOCKED with a stub and speech
 * synthesis, network and blob creation are never used. `blob:` handles here are
 * plain strings, not real URLs. These tests assert state-machine behaviour only and
 * are NOT evidence that a real podcast can be generated, resumed, downloaded or heard.
 * Cross-reload durable resume is deliberately not implemented.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generator = vi.hoisted(() => ({
  isRunning: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock("@/lib/tts/streamingTTSGenerator", () => ({
  getStreamingTTSGenerator: vi.fn(() => generator),
}));

const {
  usePodcastGenerationStore,
} = await import("@/stores/podcastGenerationStore");

const script = {
  title: "Evidence briefing",
  segments: [
    { speaker: "Alex", text: "One." },
    { speaker: "Sarah", text: "Two." },
  ],
};
const blobUrls = ["blob:seg-1", "blob:seg-2", "blob:seg-3"];

const saveRaw = (notebookId: string, payload: Record<string, unknown>) => {
  window.localStorage.setItem(
    `active_podcast_${notebookId}`,
    JSON.stringify({ timestamp: Date.now(), ...payload }),
  );
};

describe("podcast segment blob lifecycle", () => {
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    generator.cancel.mockClear();
    act(() => usePodcastGenerationStore.getState().reset());
    revoke.mockClear();
  });

  afterEach(() => revoke.mockRestore());

  const seed = () => {
    act(() => {
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script);
      usePodcastGenerationStore.getState().setAudioReady(blobUrls);
    });
  };

  it("revokes every segment blob on cancel and stops offering that audio", () => {
    seed();
    act(() => usePodcastGenerationStore.getState().cancelGeneration());

    for (const url of blobUrls) expect(revoke).toHaveBeenCalledWith(url);
    expect(generator.cancel).toHaveBeenCalledTimes(1);
    const state = usePodcastGenerationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.partialAudioUrls).toEqual([]);
    expect(state.canPlayPartial).toBe(false);
    expect(state.progress).toMatchObject({ phase: "cancelled", canPlay: false });
  });

  it("revokes discarded segments on reset and on a replacement run", () => {
    seed();
    act(() => usePodcastGenerationStore.getState().reset());
    for (const url of blobUrls) expect(revoke).toHaveBeenCalledWith(url);

    seed();
    act(() =>
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script),
    );
    for (const url of blobUrls) expect(revoke).toHaveBeenCalledWith(url);
  });

  it("never revokes a remote url, nor the final episode audio still in use", () => {
    act(() => {
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
      usePodcastGenerationStore
        .getState()
        .setAudioReady(["https://cdn.example.com/seg.mp3", "blob:seg-1"]);
      usePodcastGenerationStore
        .getState()
        .setFinalAudio("blob:final-episode", "notebook-1", "Evidence briefing");
    });
    act(() => usePodcastGenerationStore.getState().reset());

    expect(revoke).not.toHaveBeenCalledWith("https://cdn.example.com/seg.mp3");
    expect(revoke).not.toHaveBeenCalledWith("blob:final-episode");
  });
});

describe("resume never claims a run it cannot reattach to", () => {
  beforeEach(() => {
    window.localStorage.clear();
    generator.isRunning.mockReturnValue(false);
    act(() => usePodcastGenerationStore.getState().reset());
  });

  it("refuses a payload saved under a different notebook", () => {
    generator.isRunning.mockReturnValue(true);
    saveRaw("notebook-1", {
      notebookId: "notebook-2",
      script,
      partialAudioUrls: blobUrls,
    });

    let result = true;
    act(() => {
      result = usePodcastGenerationStore.getState().rehydrateState("notebook-1");
    });

    expect(result).toBe(false);
    expect(usePodcastGenerationStore.getState().isGenerating).toBe(false);
    expect(usePodcastGenerationStore.getState().script).toBeNull();
  });

  it("restores an interrupted draft rather than a false live run after a reload", () => {
    // A real page reload leaves no generator running and no live blob handles.
    generator.isRunning.mockReturnValue(false);
    saveRaw("notebook-1", {
      notebookId: "notebook-1",
      script,
      host1Name: "Robin",
      partialAudioUrls: blobUrls,
    });

    let result = true;
    act(() => {
      result = usePodcastGenerationStore.getState().rehydrateState("notebook-1");
    });

    expect(result).toBe(false);
    const state = usePodcastGenerationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.canPlayPartial).toBe(false);
    expect(state.partialAudioUrls).toEqual([]);
    expect(state.script).toEqual(script);
    expect(state.host1Name).toBe("Robin");
    expect(state.progress).toMatchObject({ canPlay: false, percentage: 0 });
    expect(state.progress?.message).toMatch(/interrupted/i);
  });

  it("does not adopt dead or non-blob handles as playable audio", () => {
    generator.isRunning.mockReturnValue(false);
    saveRaw("notebook-1", {
      notebookId: "notebook-1",
      script,
      partialAudioUrls: [
        "blob:expired-after-reload",
        "http://evil.example.com/a.mp3",
        "javascript:alert(1)",
        42,
        null,
      ],
    });

    act(() => usePodcastGenerationStore.getState().rehydrateState("notebook-1"));

    const state = usePodcastGenerationStore.getState();
    expect(state.partialAudioUrls).toEqual([]);
    expect(state.canPlayPartial).toBe(false);
  });

  it("does not report restored progress above 100% on a live reattach", () => {
    act(() => {
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
      usePodcastGenerationStore.getState().setAudioReady(blobUrls);
    });
    saveRaw("notebook-1", { notebookId: "notebook-1", script });
    generator.isRunning.mockReturnValue(true);

    let result = false;
    act(() => {
      result = usePodcastGenerationStore.getState().rehydrateState("notebook-1");
    });

    expect(result).toBe(true);
    const state = usePodcastGenerationStore.getState();
    expect(state.isGenerating).toBe(true);
    // Live handles come from the in-memory run, not from the persisted strings.
    expect(state.partialAudioUrls).toEqual(blobUrls);
    expect(state.progress?.percentage).toBeLessThanOrEqual(100);
  });

  it("will not replace another notebook's live run", () => {
    act(() =>
      usePodcastGenerationStore.getState().startGeneration("notebook-2", script),
    );
    generator.isRunning.mockReturnValue(true);
    saveRaw("notebook-1", { notebookId: "notebook-1", script });

    let result = true;
    act(() => {
      result = usePodcastGenerationStore.getState().rehydrateState("notebook-1");
    });

    expect(result).toBe(false);
    const state = usePodcastGenerationStore.getState();
    expect(state.notebookId).toBe("notebook-2");
    expect(state.isGenerating).toBe(true);
  });

  it("discards stale, unparsable and malformed saved sessions without throwing", () => {
    window.localStorage.setItem("active_podcast_notebook-1", "{not json");
    expect(usePodcastGenerationStore.getState().rehydrateState("notebook-1")).toBe(false);

    saveRaw("notebook-1", {
      notebookId: "notebook-1",
      timestamp: Date.now() - 31 * 60 * 1000,
      script,
    });
    act(() => {
      expect(
        usePodcastGenerationStore.getState().rehydrateState("notebook-1"),
      ).toBe(false);
    });

    for (const badScript of [null, "a string", { segments: null }]) {
      saveRaw("notebook-1", {
        notebookId: "notebook-1",
        script: badScript,
      });
      act(() => {
        expect(
          usePodcastGenerationStore.getState().rehydrateState("notebook-1"),
        ).toBe(false);
      });
      expect(
        usePodcastGenerationStore.getState().progress?.message ?? "",
      ).not.toMatch(/recovering/i);
    }
  });

  it("does not persist dead blob handles for a later reload", () => {
    act(() => {
      usePodcastGenerationStore.getState().startGeneration("notebook-1", script);
      usePodcastGenerationStore.getState().setAudioReady(blobUrls);
    });

    const saved = JSON.parse(
      window.localStorage.getItem("active_podcast_notebook-1") ?? "{}",
    ) as Record<string, unknown>;
    expect(saved.partialAudioUrls).toBeUndefined();
    expect(saved.script).toEqual(script);
  });
});
