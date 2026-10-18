// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAudiobookNarrationReadHandler } from "../services/audiobookNarrationReadService.js";

function fixture() {
  const manifest = { fileName: "qa.epub", ownerId: "owner", originalPath: "PRIVATE_PATH", chapters: [
    { id: "chapter", text: "Original source", narrationText: "Saved narration" },
  ], renders: { render: { chapters: { chapter: { status: "completed", audioFileName: "private.wav" } } } } };
  const req = { params: { fileName: "qa.epub", chapterId: "chapter" }, query: { renderId: "render" } };
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const loadManifest = vi.fn(() => manifest);
  let owner = "owner";
  const handler = createAudiobookNarrationReadHandler({ requestUserId: () => owner, loadManifest });
  return { manifest, req, res, loadManifest, handler, owner: value => { owner = value; },
    run: () => handler(req, res), status: () => res.status.mock.calls.at(-1)?.[0] || 200 };
}

describe("owner-only saved audiobook narration", () => {
  it("returns the persisted rendered chapter only, without private manifest fields", () => {
    const f = fixture(); f.run();
    expect(f.status()).toBe(200);
    expect(f.res.json).toHaveBeenCalledWith({ fileName: "qa.epub", renderId: "render", chapterId: "chapter", narrationText: "Saved narration" });
    expect(f.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("supports persisted source text when narration text was not separately stored", () => {
    const f = fixture(); delete f.manifest.chapters[0].narrationText; f.run();
    expect(f.res.json.mock.calls[0][0].narrationText).toBe("Original source");
  });
  it("requires authentication before any manifest access", () => {
    const f = fixture(); f.owner(null); f.run(); expect(f.status()).toBe(401); expect(f.loadManifest).not.toHaveBeenCalled();
  });
  it.each(["foreign", undefined, ""])("hides manifests owned by %s", ownerId => {
    const f = fixture(); f.manifest.ownerId = ownerId; f.run(); expect(f.status()).toBe(404);
  });
  it("hides absent manifests", () => {
    const f = fixture(); f.loadManifest.mockReturnValue(null); f.run(); expect(f.status()).toBe(404);
  });
  it("rejects a mismatched persisted filename", () => {
    const f = fixture(); f.manifest.fileName = "other.epub"; f.run(); expect(f.status()).toBe(404);
  });
  it.each(["../qa.epub", "folder/qa.epub", "folder\\qa.epub", "qa.exe", ""])("rejects unsafe filename %s without reading", fileName => {
    const f = fixture(); f.req.params.fileName = fileName; f.run(); expect(f.status()).toBe(400); expect(f.loadManifest).not.toHaveBeenCalled();
  });
  it.each([undefined, "", ["render"], "x".repeat(256)])("requires a bounded scalar render binding", renderId => {
    const f = fixture(); f.req.query.renderId = renderId; f.run(); expect(f.status()).toBe(400);
  });
  it.each(["missing", "__proto__", "constructor"])("does not resolve missing or inherited render %s", renderId => {
    const f = fixture(); f.req.query.renderId = renderId; f.run(); expect(f.status()).toBe(404);
  });
  it("does not return unrendered source chapters", () => {
    const f = fixture(); f.manifest.renders.render.chapters.chapter.status = "processing"; f.run(); expect(f.status()).toBe(404);
  });
  it("requires both saved and rendered chapter entries", () => {
    const f = fixture(); f.req.params.chapterId = "missing"; f.run(); expect(f.status()).toBe(404);
  });
  it("bounds response bytes below hosted ingress limits", () => {
    const f = fixture(); f.manifest.chapters[0].narrationText = "a".repeat(1024 * 1024); f.run(); expect(f.status()).toBe(413);
  });
  it("returns a generic failure without filesystem details", () => {
    const f = fixture(); f.loadManifest.mockImplementation(() => { throw new Error("PRIVATE_PATH"); }); f.run();
    expect(f.status()).toBe(500); expect(f.res.json).toHaveBeenCalledWith({ error: "Could not read saved narration" });
  });
});
