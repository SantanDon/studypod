import { beforeEach, describe, expect, it } from "vitest";
import {
  getStreamingPodcastProviderConfig,
  saveTTSConfig,
} from "@/lib/tts/ttsService";

describe("configured podcast streaming provider", () => {
  beforeEach(() => localStorage.clear());

  it("uses the saved Kokoro choice in the streaming path", () => {
    saveTTSConfig({ provider: "kokoro" });
    expect(getStreamingPodcastProviderConfig()).toEqual({
      useKokoro: true,
      forceWebSpeech: false,
    });
  });

  it("preserves an explicit browser speech choice", () => {
    saveTTSConfig({ provider: "web-speech" });
    expect(getStreamingPodcastProviderConfig()).toEqual({
      useKokoro: false,
      forceWebSpeech: true,
    });
  });

  it.each(["ultimate-tts", "coqui", "openai-tts"] as const)(
    "fails closed for configured %s rather than silently changing providers",
    (provider) => {
      saveTTSConfig({ provider });
      expect(() => getStreamingPodcastProviderConfig()).toThrow(
        /podcast streaming currently supports Kokoro and browser speech only/i,
      );
    },
  );
});
