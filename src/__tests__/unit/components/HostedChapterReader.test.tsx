import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("only offers part navigation for a source with more than one part", async () => {
  const sources = [
    { id: "short", title: "Short source", content: "A short passage." },
    { id: "long", title: "Long source", content: "Long passage. ".repeat(60) },
  ].map(source => ({ ...source, notebook_id: "test-parts" })) as Source[];
  const view = render(<HostedChapterReader notebookId="test-parts" sources={sources} />);
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "long" } });
  expect(screen.getByText("Part 1 of 2")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Part 2 of 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Part 1 of 2")).toBeVisible();
  view.unmount();
});

it("jumps straight to a later audiobook part and remembers it", async () => {
  const source = { id: "guide", title: "Study guide", content: "Long passage. ".repeat(180), notebook_id: "jump" } as Source;
  const open = () => render(<HostedChapterReader notebookId="jump" sources={[source]} />);
  const view = open();
  const part = screen.getByRole("combobox", { name: "Jump to audiobook part" });
  fireEvent.change(part, { target: { value: "2" } });
  expect(part).toHaveValue("2");
  view.unmount();
  const reopened = open();
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Jump to audiobook part" })).toHaveValue("2"));
  reopened.unmount();
});
it("can cancel a pending voice and retry before its callbacks finish", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chapter");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let finishOld!: () => void;
  let finishRetry!: () => void;
  voice.initialize.mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishRetry = resolve; }));
  voice.synthesize.mockResolvedValue({audioBlob: new Blob(["audio"]), audioUrl: "blob:voice"});
  const sources = [{id: "field", title: "Field notes", content: "Read the scale.", notebook_id: "field-book"}] as Source[];
  const view = render(<HostedChapterReader notebookId="field-book" sources={sources} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", {name: "Generate chapter audio"}));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", {name: "Cancel narration"}));
  expect(screen.getByRole("status")).toHaveTextContent("Narration cancelled");
  expect(voice.terminate).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Generate chapter audio"}));
  await act(async () => finishOld());
  expect(screen.getByRole("button", {name: "Cancel narration"})).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing");
  await act(async () => finishRetry());
  expect(await screen.findByText(/Ready to play/)).toBeVisible();
  expect(screen.queryByRole("button", {name: "Cancel narration"})).toBeNull();
  view.unmount();
});

it("renders long passages in sections and joins every word in its original order", async () => {
  const { encodeSpeechPcmWav } = await import("@/lib/tts/pcmWav");
  const sample = await encodeSpeechPcmWav([new Float32Array([0.4, -0.4])], 24000);
  voice.synthesize.mockClear().mockResolvedValue({ audioBlob: { arrayBuffer: async () => sample }, audioUrl: "blob:part" });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chapter");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const content = "Read the scale twice and write down the time. ".repeat(9).trim();
  const source = { id: "field", title: "Weather", content, notebook_id: "sections" } as Source;
  const view = render(<HostedChapterReader notebookId="sections" sources={[source]} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Generate chapter audio" }));
  expect(await screen.findByText(/Ready to play/)).toBeVisible();
  const calls = voice.synthesize.mock.calls.map(([text]) => text);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.every(text => text.length <= 150)).toBe(true);
  expect(calls.join(" ")).toBe(content);
  view.unmount();
});
