import { describe, expect, it } from "vitest";
import { shouldAutoRestorePodcastHistory } from "@/lib/audio/podcastHistoryRestore";

describe("shouldAutoRestorePodcastHistory", () => {
  it("does not replace a failed new generation with an older saved episode", () => {
    expect(shouldAutoRestorePodcastHistory({
      hasTerminalError: true,
      hasCurrentAudio: false,
      hasAlreadyRestored: false,
    })).toBe(false);
  });

  it("restores saved history when there is no active audio or terminal error", () => {
    expect(shouldAutoRestorePodcastHistory({
      hasTerminalError: false,
      hasCurrentAudio: false,
      hasAlreadyRestored: false,
    })).toBe(true);
  });
});
