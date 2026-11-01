import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PodcastScript } from "@/lib/podcastGenerator";

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  initialize: vi.fn(),
  cancel: vi.fn(),
  workerReady: true,
}));

vi.mock("@/lib/tts/ttsWorker", () => ({
  getTTSWorkerManager: () => ({
    isWorkerReady: () => mocks.workerReady,
    initialize: () => mocks.initialize(),
    synthesize: mocks.synthesize,
    cancel: mocks.cancel,
  }),
}));

import { getStreamingTTSGenerator } from "@/lib/tts/streamingTTSGenerator";

const script: PodcastScript = {
  title: "Reliable episode",
  segments: [
    { speaker: "Alex", text: "The first complete segment." },
    { speaker: "Sarah", text: "The second complete segment." },
  ],
  metadata: {
    host1Name: "Alex",
    host2Name: "Sarah",
    type: "brief",
    format: "dialogue",
  },
};

describe("StreamingTTSGenerator reliability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.synthesize.mockReset();
    mocks.initialize.mockReset();
    mocks.initialize.mockImplementation(async () => {
      mocks.workerReady = true;
    });
    mocks.cancel.mockReset();
    mocks.workerReady = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class Worker {},
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:fallback-${Math.random()}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("retries a failed segment and rebuilds the whole episode with fallback audio", async () => {
    mocks.synthesize
      .mockResolvedValueOnce({
        audioUrl: "blob:kokoro-first",
        audioBlob: new Blob(["first"], { type: "audio/wav" }),
        duration: 1,
      })
      .mockRejectedValueOnce(new Error("temporary worker failure"))
      .mockRejectedValueOnce(new Error("worker failure after retry"));

    const progress: Array<{
      phase: string;
      message: string;
      usingKokoro?: boolean;
    }> = [];
    const ready: Array<{ audioUrls: string[]; segmentsReady: number }> = [];

    await getStreamingTTSGenerator().startStreaming(
      script,
      { useKokoro: true },
      (event) => progress.push(event),
      (result) => ready.push(result),
    );

    expect(mocks.synthesize).toHaveBeenCalledTimes(3);
    expect(
      progress.some((event) =>
        event.message.startsWith("Retrying Sarah's line"),
      ),
    ).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      phase: "complete",
      usingKokoro: false,
    });

    const finalResult = ready.at(-1);
    expect(finalResult?.segmentsReady).toBe(2);
    expect(finalResult?.audioUrls).toHaveLength(2);
    expect(finalResult?.audioUrls).not.toContain("blob:kokoro-first");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:kokoro-first");
  });

  it("reinitializes a disposed worker before retrying synthesis", async () => {
    mocks.synthesize
      .mockImplementationOnce(async () => {
        mocks.workerReady = false;
        throw new Error("worker disposed after timeout");
      })
      .mockResolvedValue({
        audioUrl: "blob:kokoro-recovered",
        audioBlob: new Blob(["audio"], { type: "audio/wav" }),
        duration: 1,
      });

    await getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [script.segments[0]] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );

    expect(mocks.synthesize).toHaveBeenCalledTimes(2);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });

  it("retries initialization if worker recovery initialization rejects", async () => {
    mocks.synthesize
      .mockImplementationOnce(async () => {
        mocks.workerReady = false;
        throw new Error("worker disposed after timeout");
      })
      .mockResolvedValue({
        audioUrl: "blob:kokoro-after-init-retry",
        audioBlob: new Blob(["audio"], { type: "audio/wav" }),
        duration: 1,
      });
    mocks.initialize
      .mockRejectedValueOnce(new Error("model worker failed to restart"))
      .mockImplementationOnce(async () => {
        mocks.workerReady = true;
      });

    await getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [script.segments[0]] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(mocks.synthesize).toHaveBeenCalledTimes(2);
  });

  it("bounds recovery when initialization resolves without a ready worker", async () => {
    mocks.synthesize.mockImplementationOnce(async () => {
      mocks.workerReady = false;
      throw new Error("worker disposed after timeout");
    });
    mocks.initialize.mockImplementation(async () => undefined);

    await getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [script.segments[0]] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );

    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
  });

  it("does not synthesize after cancellation while worker recovery is pending", async () => {
    let finishInitialization!: () => void;
    mocks.synthesize.mockImplementationOnce(async () => {
      mocks.workerReady = false;
      throw new Error("worker disposed after timeout");
    });
    mocks.initialize.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishInitialization = () => {
        mocks.workerReady = true;
        resolve();
      };
    }));
    const run = getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [script.segments[0]] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));

    getStreamingTTSGenerator().cancel();
    finishInitialization();
    await run;

    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(getStreamingTTSGenerator().isRunning()).toBe(false);
  });

  it("splits long narration into bounded chunks without changing text order or speaker", async () => {
    const sourceText = Array.from({ length: 18 }, (_, index) =>
      `Sentence ${index + 1} has enough words to provide a meaningful chunk boundary.`,
    ).join(" ");
    const synthesized: string[] = [];
    mocks.synthesize.mockImplementation(async (text: string) => {
      synthesized.push(text);
      return {
        audioUrl: `blob:chunk-${synthesized.length}`,
        audioBlob: new Blob(["audio"], { type: "audio/wav" }),
        duration: 1,
      };
    });

    await getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [{ speaker: "Alex", text: sourceText }] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );

    expect(synthesized.length).toBeGreaterThan(1);
    expect(synthesized.every((chunk) => chunk.length <= 420)).toBe(true);
    const generated = getStreamingTTSGenerator().getGeneratedSegments();
    expect(generated.map((item) => item.text).join("")).toBe(sourceText);
    expect(generated.every((item) => item.speaker === "Alex")).toBe(true);
  });

  it("keeps a whitespace at the chunk limit in the following chunk", async () => {
    const sourceText = `${"a".repeat(420)} ${"b".repeat(8)}`;
    const synthesized: string[] = [];
    mocks.synthesize.mockImplementation(async (text: string) => {
      synthesized.push(text);
      return {
        audioUrl: `blob:boundary-${synthesized.length}`,
        audioBlob: new Blob(["audio"], { type: "audio/wav" }),
        duration: 1,
      };
    });

    await getStreamingTTSGenerator().startStreaming(
      { ...script, segments: [{ speaker: "Alex", text: sourceText }] },
      { useKokoro: true },
      () => undefined,
      () => undefined,
    );

    expect(synthesized).toHaveLength(2);
    const generated = getStreamingTTSGenerator().getGeneratedSegments();
    expect(generated.every((chunk) => chunk.text.length <= 420)).toBe(true);
    expect(generated.map((chunk) => chunk.text).join("")).toBe(sourceText);
  });
});
