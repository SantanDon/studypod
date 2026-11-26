import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PodcastHistory } from "@/components/notebook/PodcastHistory";

const mocked = vi.hoisted(() => ({ loadAudio: vi.fn(), podcasts: [] as unknown[] }))
vi.mock("@/hooks/usePodcastHistory", () => ({
  usePodcastHistory: () => ({
    podcasts: mocked.podcasts, isLoading: false,
    loadAudio: mocked.loadAudio, deletePodcast: vi.fn(), isDeleting: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("saved podcast download", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocked.podcasts = [];
    mocked.loadAudio.mockReset();
  });

  it("keeps source access and deletion next to the player while other episodes retain playback and download", () => {
    mocked.podcasts = ["Current lesson", "Earlier lesson"].map((title, index) => ({
      id: `episode-${index}`, notebook_id: "book-1", title,
      created_at: "2026-11-01T10:00:00Z", source_ids: [],
    }));
    render(<PodcastHistory notebookId="book-1" playerVisible currentPodcastId="episode-0" onPlay={vi.fn()} sources={[]} sourcesLoading={false} sourcesError={null} sourcesFetching={false} retrySources={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Play Current lesson" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare download for Current lesson" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Current lesson" })).toBeVisible();
    expect(screen.getAllByText("Sources used for this audio (0)")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Play Earlier lesson" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Prepare download for Earlier lesson" })).toBeVisible();
  });

  it("prepares audio first and starts the download only on a fresh follow-up click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocked.podcasts = [{
      id: "episode-1", notebook_id: "book-1", title: "Guided source discussion",
      created_at: "2026-11-01T10:00:00Z", duration: 24, source_ids: [],
    }];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved-episode");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename: string | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });

    let resolveLoad!: (blob: Blob) => void;
    const pendingLoad = new Promise<Blob>((resolve) => { resolveLoad = resolve; });
    mocked.loadAudio.mockReturnValue(pendingLoad);
    render(<PodcastHistory notebookId="book-1" onPlay={vi.fn()} sources={[]} sourcesLoading={false} sourcesError={null} sourcesFetching={false} retrySources={vi.fn()} />);
    expect(screen.getByText(/0:24$/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Prepare download for Guided source discussion" }));

    expect(mocked.loadAudio).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Preparing download for Guided source discussion" })).toBeDisabled();

    resolveLoad(new Blob(["RIFF"], { type: "audio/wav" }));
    const downloadButton = await screen.findByRole("button", { name: "Download file for Guided source discussion" });
    expect(screen.getByRole("status").textContent).toContain("Audio ready");
    expect(click).not.toHaveBeenCalled();

    fireEvent.click(downloadButton);

    expect(filename).toBe("guided_source_discussion.wav");
    expect(mocked.loadAudio).toHaveBeenCalledTimes(1);
    fireEvent.click(downloadButton);
    expect(click).toHaveBeenCalledTimes(2);
    expect(mocked.loadAudio).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:saved-episode");
    vi.useRealTimers();
  });
});
