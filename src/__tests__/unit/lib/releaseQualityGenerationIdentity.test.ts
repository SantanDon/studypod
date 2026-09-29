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

// The generator is a module-level singleton, and a cancelled run only clears
// `isGenerating` once its in-flight segment unwinds. Reset the module registry so each
// test gets a genuinely fresh instance instead of inheriting a stuck run.
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

  it('holds the run guard through reset and discards a late provider result before internal storage', async () => {
    const generator = await loadGenerator();
    mocks.synthesize.mockImplementation(() => new Promise(resolve => { resolveSynthesize = resolve; }));
    const ready = vi.fn();
    const config = { useKokoro: true, forceWebSpeech: false, host1Voice: 'am_onyx', host2Voice: 'af_nova' };
    const running = generator.startStreaming(script, config, vi.fn(), ready);
    await vi.waitFor(() => expect(mocks.synthesize).toHaveBeenCalled());
    generator.reset();
    expect(generator.isRunning()).toBe(true);
    await expect(generator.startStreaming(script, config, vi.fn(), vi.fn())).rejects.toThrow(/already running/i);
    resolveSynthesize({ audioUrl: 'blob:discard-late', audioBlob: new Blob(['fixture']), duration: 1 });
    await running;
    expect(generator.isRunning()).toBe(false);
    expect(generator.getGeneratedSegments()).toEqual([]);
    expect(ready).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:discard-late');
    mocks.synthesize.mockResolvedValue({ audioUrl: 'blob:next-run', audioBlob: new Blob(['fixture']), duration: 1 });
    await generator.startStreaming(script, config, vi.fn(), vi.fn());
    expect(generator.getGeneratedSegments().map(item => item.url)).toEqual(['blob:next-run']);
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
