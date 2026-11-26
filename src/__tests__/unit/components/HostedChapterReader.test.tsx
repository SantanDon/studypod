import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HostedChapterReader from "@/components/notebook/HostedChapterReader";
import type { Source } from "@/hooks/useSources";

const voice = vi.hoisted(() => ({
  created: vi.fn(), initialize: vi.fn(), synthesize: vi.fn(), terminate: vi.fn(),
}));
vi.mock("@/lib/tts/ttsWorker", () => ({
  TTSWorkerManager: class {
    constructor() { voice.created(); }
    initialize = voice.initialize;
    synthesize = voice.synthesize;
    terminate = voice.terminate;
  },
}));
vi.mock("@/services/podcastApiService", () => ({
  podcastApi: () => ({
    list: async () => [],
    save: async (r: { sourceIds: string[] }) => ({ ...r, source_ids: r.sourceIds }),
    audio: async () => new Blob(["audio"]),
  }),
}));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("reports received bytes, reuses the narrator for another chapter, and frees it after inactivity", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chapter");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let initialized!: () => void;
  voice.initialize.mockImplementationOnce((progress: (msg: string) => void) => {
    progress("Downloading the voice model (4.0 MB received)…");
    return new Promise<void>(resolve => { initialized = resolve; });
  });
  voice.synthesize.mockResolvedValue({ audioBlob: new Blob(["audio"]), audioUrl: "blob:working" });
  const sources = ["One", "Two"].map(title => ({ id: title, title, notebook_id: "book", content: title })) as Source[];
  const view = render(<HostedChapterReader notebookId="book" sources={sources} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Generate chapter audio" }));
  expect(await screen.findByText(/4.0 MB received/)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("The first download can take a few minutes.");
  expect(screen.getByRole("status")).not.toHaveTextContent("MB received");
  await act(async () => initialized());
  expect(await screen.findByText(/Ready to play/)).toBeVisible();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Two" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate chapter audio" }));
  expect(await screen.findByText(/Ready to play/)).toBeVisible();
  expect(voice.created).toHaveBeenCalledTimes(1);
  expect(voice.synthesize).toHaveBeenCalledTimes(2);
  expect(voice.terminate).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(120_000));
  expect(voice.terminate).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(voice.terminate).toHaveBeenCalledTimes(1);
});
