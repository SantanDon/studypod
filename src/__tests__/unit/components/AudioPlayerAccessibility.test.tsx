import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AudioPlayer from "@/components/notebook/AudioPlayer";
import { Slider } from "@/components/ui/slider";

const handlers = vi.hoisted(() => ({
  togglePlayPause: vi.fn(), handleSeek: vi.fn(), handleVolumeChange: vi.fn(),
  handlePlaybackRateChange: vi.fn(), restart: vi.fn(), retryLoad: vi.fn(),
  downloadAudio: vi.fn(), deleteAudio: vi.fn(), formatTime: (time: number) => String(time),
}));

// Exercise the real controls without loading media or invoking a provider.
vi.mock("@/components/notebook/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => ({
    state: { isPlaying: false, currentTime: 10, duration: 60, volume: 0.5,
      loading: false, isDeleting: false, isDownloading: false, audioError: null,
      autoRetryInProgress: false, playbackRate: 1, resumedFrom: 0 },
    refs: { audioRef: { current: null } }, handlers,
  }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("audio control accessibility", () => {
  it("names the focusable playback thumb and routes keyboard seek to the player", () => {
    render(<AudioPlayer audioUrl="/synthetic.wav" title="Cedar conversation" />);
    const seek = screen.getByRole("slider", { name: "Cedar conversation playback position" });
    expect(seek).toHaveAttribute("tabindex", "0");
    expect(seek).toHaveAttribute("aria-valuenow", "10");
    seek.focus();
    expect(seek).toHaveFocus();
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(handlers.handleSeek).toHaveBeenLastCalledWith([11]);
    fireEvent.keyDown(seek, { key: "End" });
    expect(handlers.handleSeek).toHaveBeenLastCalledWith([60]);
    expect(screen.getByRole("button", { name: "Restart from the beginning" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("tabindex", "0");
  });

  it("names the icon-only audio options trigger", () => {
    render(<AudioPlayer audioUrl="/synthetic.wav" title="Cedar conversation" />);
    expect(screen.getByRole("button", { name: "Cedar conversation audio options" }))
      .toHaveAttribute("aria-haspopup", "menu");
  });

  it("preserves visible labels and descriptions on the interactive thumb", () => {
    render(<><span id="chapter-label">Chapter position</span>
      <span id="chapter-help">Seek within the current chapter</span>
      <Slider defaultValue={[10]} max={60} aria-label="Fallback position"
        aria-labelledby="chapter-label" aria-describedby="chapter-help" /></>);
    const seek = screen.getByRole("slider", { name: "Chapter position" });
    expect(seek).toHaveAccessibleDescription("Seek within the current chapter");
    expect(seek).toHaveAttribute("aria-label", "Fallback position");
  });
});
