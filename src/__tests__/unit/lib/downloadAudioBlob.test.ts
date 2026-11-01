import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAudioBlob } from "@/lib/audio/downloadAudioBlob";

describe("downloadAudioBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a WAV download named as WAV and lets the browser consume its URL", () => {
    vi.useFakeTimers();
    const objectUrl = "blob:episode";
    vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let downloadedName: string | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    downloadAudioBlob(new Blob(["RIFF"], { type: "audio/wav" }), "Guided source discussion");

    const link = document.querySelector<HTMLAnchorElement>('a[download="Guided source discussion.wav"]');
    expect(link).toBeNull(); // The temporary anchor is removed after the click.
    expect(downloadedName).toBe("Guided source discussion.wav");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith(objectUrl);
  });

  it("uses the fetched audio MIME type for the download extension", () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:episode");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let downloadedName: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    downloadAudioBlob(new Blob(["audio"], { type: "audio/mpeg" }), "Episode.wav");
    expect(downloadedName).toBe("Episode.mp3");
  });
});
