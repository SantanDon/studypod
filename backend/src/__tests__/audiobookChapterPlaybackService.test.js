// @vitest-environment node
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveCompactChapterPlaybackAsset } from "../services/audiobookChapterPlaybackService.js";

const candidate = (overrides = {}) => ({
  chapters: {
    one: { status: "completed", audioFileName: "chapter.wav", durationSeconds: 4638.58 },
  },
  final: { status: "completed", format: "mp3", fileName: "book.mp3", durationSeconds: 4638.579 },
  ...overrides,
});

describe("resolveCompactChapterPlaybackAsset", () => {
  it("uses a usable matching compact export for the only completed chapter", () => {
    const isUsableAudioFile = vi.fn(() => true);
    expect(resolveCompactChapterPlaybackAsset({
      render: candidate(), chapterId: "one", cacheDir: "/cache", isUsableAudioFile,
    })).toEqual({ filePath: path.join("/cache", "book.mp3"), contentType: "audio/mpeg" });
    expect(isUsableAudioFile).toHaveBeenCalledWith(path.join("/cache", "book.mp3"));
  });

  it("keeps chapter WAVs for ambiguous, mismatched, unsafe, or unusable exports", () => {
    const isUsableAudioFile = () => true;
    const resolve = (render) => resolveCompactChapterPlaybackAsset({
      render, chapterId: "one", cacheDir: "/cache", isUsableAudioFile,
    });
    expect(resolve(candidate({ chapters: {
      ...candidate().chapters,
      two: { status: "completed", audioFileName: "two.wav" },
    } }))).toBeNull();
    expect(resolve(candidate({ final: { ...candidate().final, durationSeconds: 4600 } }))).toBeNull();
    expect(resolve(candidate({ final: { ...candidate().final, fileName: "../book.mp3" } }))).toBeNull();
    expect(resolve(candidate({ final: { ...candidate().final, format: "wav" } }))).toBeNull();
    expect(resolveCompactChapterPlaybackAsset({
      render: candidate(), chapterId: "one", cacheDir: "/cache", isUsableAudioFile: () => false,
    })).toBeNull();
  });
});
