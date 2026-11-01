import { describe, expect, it, vi } from "vitest";
import { assignAudiobookAudioNode, audiobookBufferingStatus, audiobookStatusLabel, ownsAudiobookReadingContext, resolveChapterResumePosition, resolveListeningQuestionPosition } from "@/components/notebook/AudiobookChapterPlayer";

describe("audiobook chapter status and resume", () => {
  it("keeps callback ref detach and attach bookkeeping from stopping playback", () => {
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const load = vi.fn();
    const audio = { pause, removeAttribute, load } as unknown as HTMLAudioElement;
    const ref: { current: HTMLAudioElement | null } = { current: audio };

    assignAudiobookAudioNode(ref, null);
    assignAudiobookAudioNode(ref, audio);

    expect(ref.current).toBe(audio);
    expect(pause).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("shows buffering while media is not yet playable and leaves real errors visible", () => {
    expect(audiobookBufferingStatus(true, null)).toMatch(/buffering/i);
    expect(audiobookBufferingStatus(true, "The selected chapter could not be played.")).toBeNull();
    expect(audiobookBufferingStatus(false, null)).toBeNull();
  });

  it("distinguishes partial audio from a fully ready audiobook", () => {
    expect(audiobookStatusLabel("completed", 1, 13)).toBe("Audio available · 1 of 13 chapters ready");
    expect(audiobookStatusLabel("completed", 13, 13)).toBe("All 13 chapters are ready");
    expect(audiobookStatusLabel("completed", 0, 13)).toBe("No audio available yet");
  });

  it("restores the active chapter position when its audio source reloads, including zero", () => {
    expect(resolveChapterResumePosition({ selectedChapterId: "ch-1", savedChapterId: "ch-1", savedPosition: 74, activeChapterId: "ch-1", activePosition: 0 })).toBe(0);
    expect(resolveChapterResumePosition({ selectedChapterId: "ch-1", savedChapterId: "ch-1", savedPosition: 74, activeChapterId: "ch-1", activePosition: 92 })).toBe(92);
  });

  it("uses saved progress only for the selected chapter and starts other chapters at zero", () => {
    expect(resolveChapterResumePosition({ selectedChapterId: "ch-1", savedChapterId: "ch-1", savedPosition: 74, activeChapterId: null, activePosition: null })).toBe(74);
    expect(resolveChapterResumePosition({ selectedChapterId: "ch-2", savedChapterId: "ch-1", savedPosition: 74, activeChapterId: null, activePosition: null })).toBe(0);
  });

  it("prefers a finite live media position, including zero, over stale state", () => {
    expect(resolveListeningQuestionPosition(34.82069, 34.82069, 0)).toBe(34.82069);
    expect(resolveListeningQuestionPosition(0, 34.82069, 34.82069)).toBe(0);
    expect(resolveListeningQuestionPosition(0, 0, 0)).toBe(0);
    expect(resolveListeningQuestionPosition(null, 34.82069, 0)).toBe(34.82069);
    expect(resolveListeningQuestionPosition(undefined, Number.NaN, 34.82069)).toBe(34.82069);
  });

  it("clears stale reading context only when this player still owns it", () => {
    const owner = { audiobookId: "render-a", sourceId: "source-a" };
    expect(ownsAudiobookReadingContext(owner, owner)).toBe(true);
    expect(ownsAudiobookReadingContext({ audiobookId: "render-b", sourceId: "source-a" }, owner)).toBe(false);
    expect(ownsAudiobookReadingContext({ audiobookId: "render-a", sourceId: "source-b" }, owner)).toBe(false);
    expect(ownsAudiobookReadingContext(null, owner)).toBe(false);
  });

});
