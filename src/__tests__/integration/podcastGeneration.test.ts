// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
import { generatePodcastScript } from "@/lib/podcastGenerator";
import { getPodcastAudioGenerator } from "@/lib/tts/podcastAudioGenerator";

vi.mock("@/lib/tts/wavUtils", () => ({
  combineWavBlobs: vi
    .fn()
    .mockResolvedValue(new Blob(["RIFF", "WAVE"], { type: "audio/wav" })),
}));

// Mock Ollama service
vi.mock("@/lib/ai/ollamaService", () => ({
  chatCompletion: vi.fn().mockResolvedValue(
    JSON.stringify({
      passageIds: ["p1", "p2"],
    }),
  ),
}));

// Mock TTS providers
vi.mock("@/lib/tts/kokoroPremiumTTSProvider", () => ({
  getKokoroPremiumProvider: () => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    synthesize: vi
      .fn()
      .mockResolvedValue({ audioUrl: "blob://test", duration: 100 }),
    getVoices: vi.fn().mockResolvedValue([]),
  }),
}));

// Mock worker manager to avoid real synthesis
vi.mock("@/lib/tts/ttsWorker", () => ({
  TTSWorkerManager: {
    isSupported: vi.fn().mockReturnValue(true),
  },
  getTTSWorkerManager: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    synthesize: vi
      .fn()
      .mockResolvedValue({
        audioBlob: new Blob(["mock segment"], { type: "audio/wav" }),
        audioUrl: "blob://test",
        duration: 100,
      }),
    isWorkerReady: vi.fn().mockReturnValue(true),
  }),
}));

test("compiled faithful passages flow through the mocked audio pipeline", async () => {
  const content = "A pilot study is planned. No results have been measured.\n\nThe protocol will compare twelve learners.";
  const script = await generatePodcastScript(content, { type: "standard" });
  expect(script.segments.some(s => s.text === "A pilot study is planned. No results have been measured.")).toBe(true);

  const generator = getPodcastAudioGenerator();
  const result = await generator.generatePodcastAudio(script, {});
  expect(result.segments.length).toBe(script.segments.length);
  expect(result.duration).toBeGreaterThan(60);
  expect(result.audioBlob.type).toBe("audio/wav");
  expect(result.audioBlob.size).toBeGreaterThan(0);
});
