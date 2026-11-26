/**
 * Release-quality guards for generation execution identity and audiobook command
 * source scoping.
 *
 * Provider honesty: the TTS worker/speech provider is never invoked. Q3 is proven with
 * a DEFERRED synthetic provider response driven through a stubbed generator, not with
 * real audio. Q4 exercises the in-memory command queue only. Neither test is evidence
 * that a real podcast or audiobook can be produced.
 */
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseStudioAudioIntent,
  useStudioAudioCommands,
} from "@/lib/audio/studioAudioCommands";

// Provider honesty: the Kokoro TTS worker is a STUB and `synthesize` is a DEFERRED
// synthetic promise we resolve by hand. No real model speech provider, worker or
// audio file is involved. This proves execution-identity bookkeeping only; it is not
// evidence that real narration is generated or audible.
const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  initialize: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/tts/ttsWorker", () => ({
  getTTSWorkerManager: () => ({
    isWorkerReady: () => true,
    initialize: mocks.initialize,
    synthesize: mocks.synthesize,
    cancel: mocks.cancel,
  }),
}));

// Each scenario starts with a fresh generator singleton.
const loadGenerator = async () => {
  vi.resetModules();
  const mod = await import("@/lib/tts/streamingTTSGenerator");
  return mod.getStreamingTTSGenerator();
};

describe("a superseded generation run cannot report into a newer run", () => {
  const script = {
    title: "Deferred episode",
    segments: [{ speaker: "Alex", text: "A single deferred segment." }],
  };

  let resolveSynthesize: (value: unknown) => void = () => {};

  beforeEach(() => {
    mocks.synthesize.mockReset();
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.cancel.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class Worker {},
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:created"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("drops a late result from a run cancelled before its audio arrived", async () => {
    const generator = await loadGenerator();
    const ready: unknown[] = [];

    // Run A: the provider never answers until we say so.
    mocks.synthesize.mockImplementation(
      () => new Promise((resolve) => (resolveSynthesize = resolve)),
    );
    void generator
      .startStreaming(
        script,
        { useKokoro: true, forceWebSpeech: false },
        () => undefined,
        (result) => ready.push(result),
      )
      .catch(() => undefined);

    await vi.waitFor(() => expect(mocks.synthesize).toHaveBeenCalled());
    expect(generator.isRunning()).toBe(true);

    // The user cancels while the provider is still working.
    generator.cancel();

    // The straggler finally answers. It must not be reported as ready audio.
    await act(async () => {
      resolveSynthesize({
        audioUrl: "blob:stale-run-a",
        audioBlob: new Blob(["a"], { type: "audio/wav" }),
        duration: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ready).toEqual([]);
  });

  it.each(['worker', 'fallback'])('allows immediate retry while cancelled %s generation unwinds', async provider => {
    const generator = await loadGenerator();
    let releaseOld: (value: unknown) => void = () => {};
    let releaseNew: (value: unknown) => void = () => {};
    const config = { useKokoro: true, host1Voice: 'am_onyx', host2Voice: 'af_nova' };
    if (provider === 'worker') {
      mocks.synthesize.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
    }
    mocks.synthesize.mockImplementationOnce(() => new Promise(resolve => { releaseNew = resolve; }));
    const oldReady = vi.fn();
    const oldProgress = vi.fn();
    const old = generator.startStreaming(script, { ...config, forceWebSpeech: provider === 'fallback' }, oldProgress, oldReady);
    await vi.waitFor(() => expect(provider === 'worker' ? mocks.synthesize : oldProgress).toHaveBeenCalled());
    generator.cancel();
    expect(generator.isRunning()).toBe(false);
    const replacement = generator.startStreaming(script, config, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(mocks.synthesize).toHaveBeenCalledTimes(provider === 'worker' ? 2 : 1));
    const result = (url: string) => ({ audioUrl: url, audioBlob: new Blob(['fixture']), duration: 1 });
    releaseOld(result('blob:obsolete'));
    await old;
    expect(generator.isRunning()).toBe(true);
    expect(generator.getGeneratedSegments()).toEqual([]);
    expect(oldReady).not.toHaveBeenCalled();
    if (provider === 'worker') expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:obsolete');
    releaseNew(result('blob:replacement'));
    await replacement;
    expect(generator.getGeneratedSegments().map(segment => segment.url)).toEqual(['blob:replacement']);
    generator.reset();
  });

  it("refuses a second start while a run is live instead of silently no-opping", async () => {
    const generator = await loadGenerator();
    mocks.synthesize.mockImplementation(() => new Promise(() => undefined));

    void generator
      .startStreaming(
        script,
        { useKokoro: true, forceWebSpeech: false },
        () => undefined,
        () => undefined,
      )
      .catch(() => undefined);

    await vi.waitFor(() => expect(mocks.synthesize).toHaveBeenCalled());

    // A silent no-op here would leave the store claiming "generating" with no
    // generator running. It must surface as a rejection instead.
    await expect(
      generator.startStreaming(
        script,
        { useKokoro: true, forceWebSpeech: false },
        () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow(/already running/i);
  });
});

describe("audiobook commands require exactly one identified book", () => {
  beforeEach(() => useStudioAudioCommands.setState({ requests: {} }));

  const draftAudiobook = (text: string, notebookId = "notebook-a") => {
    const intent = parseStudioAudioIntent(text)!;
    expect(useStudioAudioCommands.getState().draft(notebookId, intent)).toBe(
      true,
    );
    return useStudioAudioCommands.getState().requests[notebookId];
  };

  it.each([
    ["Cancel my audiobook", "cancel"],
    ["Check my audiobook status", "status"],
    ["Read this whole PDF aloud", "generate"],
    ["Resume my audiobook", "resume"],
  ])("refuses %s with zero or multiple source ids", (text) => {
    const request = draftAudiobook(text);
    const store = useStudioAudioCommands.getState();

    expect(store.queue("notebook-a", request.id, [])).toBe(false);
    expect(store.queue("notebook-a", request.id, ["a", "b"])).toBe(false);
    expect(useStudioAudioCommands.getState().requests["notebook-a"].phase).toBe(
      "draft",
    );
  });

  it("accepts an audiobook command naming exactly one book", () => {
    const request = draftAudiobook("Cancel my audiobook");
    expect(
      useStudioAudioCommands.getState().queue("notebook-a", request.id, ["book-1"]),
    ).toBe(true);
    expect(useStudioAudioCommands.getState().requests["notebook-a"].phase).toBe(
      "queued",
    );
  });

  it("still allows a podcast to span several chosen sources", () => {
    const request = draftAudiobook("Make a podcast from these documents");
    expect(
      useStudioAudioCommands
        .getState()
        .queue("notebook-a", request.id, ["src-1", "src-2"]),
    ).toBe(true);
  });
});
