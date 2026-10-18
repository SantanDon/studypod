import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSavedAudiobookRender } from "../../../components/notebook/AudiobookView";
import { useAudiobookStore } from "@/stores/audiobookStore";
const headers = () => ({ Authorization: "Bearer unit-owner" });
const props = { identity: "owner:notebook:source", fileName: "owned book.pdf", hasLocalJob: false, authHeaders: headers };
const manifest = { fileName: props.fileName, renderId: "saved-render", status: "completed", final: { ready: true, url: "/api/owned-download" }, listenerState: { currentChapterId: "chapter-2", playbackRate: 1.5, currentTimeSeconds: 20 }, bookmarks: [{ id: "saved-bookmark" }] };
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, json: async () => value }) as Response;
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(accept => { resolve = accept; }); return { promise, resolve }; };
afterEach(() => vi.unstubAllGlobals());
describe("owner saved audiobook discovery", () => {
 it("recovers cloud render, listener state and bookmarks without creating browser jobs", async () => {
  const before = useAudiobookStore.getState().jobs;
  const fetch = vi.fn().mockResolvedValue(response(manifest)); vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useSavedAudiobookRender(props));
  await waitFor(() => expect(result.current.manifest).toEqual(manifest));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("owned%20book.pdf/playback-manifest"), expect.objectContaining({ credentials: "include", cache: "no-store", headers: headers() }));
  expect(useAudiobookStore.getState().jobs).toBe(before);
 });
 it.each([404, 200])("allows new creation when no saved render exists (%s)", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ fileName: props.fileName, renderId: null }, status)));
  const { result } = renderHook(() => useSavedAudiobookRender(props));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.manifest).toBeNull(); expect(result.current.error).toBeNull();
 });
 it("keeps discovery failure explicit and recovers on retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(null, 500)).mockResolvedValueOnce(response(manifest)));
  const { result } = renderHook(() => useSavedAudiobookRender(props));
  await waitFor(() => expect(result.current.error).toMatch(/Try again/));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.manifest).toEqual(manifest));
 });
 it.each(["account", "notebook", "source"])("ignores late response after changing %s", async scope => {
  const old = deferred(), next = deferred();
  const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise); vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(input => useSavedAudiobookRender(input), { initialProps: props });
  rerender({ ...props, identity: scope + ":new" });
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => old.resolve(response(manifest)));
  expect(result.current.manifest).toBeNull(); expect(result.current.loading).toBe(true);
  await act(async () => next.resolve(response({ ...manifest, renderId: "new-owner-render" })));
  await waitFor(() => expect(result.current.manifest?.renderId).toBe("new-owner-render"));
 });
 it("never discovers over an existing browser execution", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useSavedAudiobookRender({ ...props, hasLocalJob: true }));
  expect(fetch).not.toHaveBeenCalled(); expect(result.current.manifest).toBeNull();
 });
 it("preserves a newer local execution even when old discovery completes", async () => {
  const old = deferred(); const fetch = vi.fn().mockReturnValue(old.promise); vi.stubGlobal("fetch", fetch);
  const before = useAudiobookStore.getState().jobs;
  const { result, rerender } = renderHook(input => useSavedAudiobookRender(input), { initialProps: props });
  rerender({ ...props, hasLocalJob: true });
  await act(async () => old.resolve(response(manifest)));
  expect(result.current.manifest).toBeNull(); expect(result.current.loading).toBe(false);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(useAudiobookStore.getState().jobs).toBe(before);
 });
 it("rejects a mismatched source manifest", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...manifest, fileName: "another-book.pdf" })));
  const { result } = renderHook(() => useSavedAudiobookRender(props));
  await waitFor(() => expect(result.current.error).toMatch(/did not match/));
  expect(result.current.manifest).toBeNull();
 });
});
