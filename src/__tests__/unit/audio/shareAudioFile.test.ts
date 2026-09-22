import { describe, expect, it, vi } from "vitest";
import { shareAudioFile } from "@/lib/audio/shareAudioFile";

const audioResponse = () =>
  ({
    ok: true,
    status: 200,
    blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
  }) as Response;

describe("shareAudioFile", () => {
  it("shares the generated audiobook as a file when Web Share supports files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const outcome = await shareAudioFile({
      url: "/audio/book.mp3",
      fileName: "The-Republic.mp3",
      title: "The Republic",
      fetchImpl: vi.fn().mockResolvedValue(audioResponse()) as typeof fetch,
      navigatorImpl: {
        share,
        canShare: vi.fn().mockReturnValue(true),
      } as Pick<Navigator, "share" | "canShare">,
    });

    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0][0] as ShareData;
    expect(payload.files?.[0]?.name).toBe("The-Republic.mp3");
  });

  it("reports unsupported without downloading when the browser has no share API", async () => {
    const fetchImpl = vi.fn();
    const outcome = await shareAudioFile({
      url: "/audio/book.mp3",
      fileName: "The-Republic.mp3",
      title: "The Republic",
      fetchImpl: fetchImpl as typeof fetch,
      navigatorImpl: {} as Pick<Navigator, "share" | "canShare">,
    });

    expect(outcome).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats cancelling the native share sheet as a non-error", async () => {
    const outcome = await shareAudioFile({
      url: "/audio/book.mp3",
      fileName: "The-Republic.mp3",
      title: "The Republic",
      fetchImpl: vi.fn().mockResolvedValue(audioResponse()) as typeof fetch,
      navigatorImpl: {
        share: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")),
        canShare: vi.fn().mockReturnValue(true),
      } as Pick<Navigator, "share" | "canShare">,
    });

    expect(outcome).toBe("cancelled");
  });
});
