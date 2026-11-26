import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAudioPlayer } from "@/components/notebook/hooks/useAudioPlayer";

const generator = vi.hoisted(() => ({
  getGeneratedSegments: () => [{ duration: 8 }, { duration: 12 }],
  stopPlayback: vi.fn(),
  playAll: vi.fn(),
}));
vi.mock("@/lib/tts/streamingTTSGenerator", () => ({ getStreamingTTSGenerator: () => generator }));

it("resumes at the selected speech segment and restarts from the beginning", () => {
  const { result } = renderHook(() => useAudioPlayer({ audioUrl: "webspeech_fallback" }));
  act(() => result.current.handlers.handleSeek([8]));
  act(() => result.current.handlers.togglePlayPause());
  expect(generator.playAll.mock.lastCall?.[0]).toBe(1);
  act(() => result.current.handlers.restart());
  expect(generator.playAll.mock.lastCall?.[0]).toBe(0);
  act(() => result.current.handlers.handleSeek([12]));
  expect(generator.playAll.mock.lastCall?.[0]).toBe(1);
  act(() => result.current.handlers.togglePlayPause());
  expect(generator.stopPlayback).toHaveBeenCalled();
});
