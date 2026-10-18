// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteOwnedAudiobookBook, createDeleteAudiobookBookHandler } from "../services/audiobookBookDeletionService.js";
import { manifestPathFor, saveBookManifest } from "../services/audiobookBookService.js";
import { withAudiobookManifestLock } from "../services/audiobookManifestService.js";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-delete-book-"));
  roots.push(root);
  const options = {
    fileName: "qa-book.epub", ownerId: "qa-owner", uploadsDir: path.join(root, "uploads"),
    manifestDir: path.join(root, "manifests"), audioCacheDir: path.join(root, "audio"),
    listBookJobs: vi.fn(() => []), readJob: vi.fn(), isWorkerActive: vi.fn(() => false),
    writeCancelMarker: vi.fn(() => ({ ok: true })),
  };
  for (const dir of [options.uploadsDir, options.manifestDir, options.audioCacheDir]) fs.mkdirSync(dir);
  const manifest = { fileName: options.fileName, ownerId: options.ownerId,
    originalPath: path.join(options.uploadsDir, options.fileName), chapters: [],
    renders: { render: { status: "completed", final: { fileName: "qa-final.wav" },
      chapters: { one: { status: "completed", audioFileName: "qa-chapter.wav" } } } }, ...overrides };
  fs.writeFileSync(manifest.originalPath || path.join(options.uploadsDir, options.fileName), "book");
  for (const name of ["qa-final.wav", "qa-chapter.wav", "unrelated.wav"]) fs.writeFileSync(path.join(options.audioCacheDir, name), name);
  saveBookManifest(options.manifestDir, manifest);
  return { root, options, manifest, manifestPath: manifestPathFor(options.manifestDir, options.fileName),
    save: () => saveBookManifest(options.manifestDir, manifest) };
}

describe("exact owned audiobook deletion", () => {
  it("allows inactive cancelled renders with unfinished chapter entries once their worker has stopped", async () => {
    const { options, manifest, save } = fixture();
    manifest.renders.render.status = "cancelled";
    manifest.renders.render.chapters.one.status = "pending";
    save();
    expect(await deleteOwnedAudiobookBook(options)).toEqual({ deleted: true, fileName: options.fileName });
  });
  it("removes the exact upload, manifest and chapter/final audio while preserving unrelated assets", async () => {
    const { options, manifestPath } = fixture();
    fs.writeFileSync(path.join(options.uploadsDir, "unrelated.epub"), "keep");
    expect(await deleteOwnedAudiobookBook(options)).toEqual({ deleted: true, fileName: options.fileName });
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(fs.readdirSync(options.manifestDir)).toEqual([]);
    expect(fs.readdirSync(options.uploadsDir)).toEqual(["unrelated.epub"]);
    expect(fs.readdirSync(options.audioCacheDir)).toEqual(["unrelated.wav"]);
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 404 });
  });
  it.each(["other-owner", undefined, ""])("refuses foreign or ownerless persisted ownership %s", async (ownerId) => {
    const { options, manifestPath } = fixture({ ownerId });
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 404 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(options.uploadsDir, options.fileName))).toBe(true);
    expect(options.writeCancelMarker).not.toHaveBeenCalled();
  });
  it("refuses a manifest filename collision and missing authentication", async () => {
    const { options, manifest, save } = fixture();
    manifest.fileName = "qa-book.pdf";
    // Persist at the same stem-derived manifest path.
    save();
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 404 });
    await expect(deleteOwnedAudiobookBook({ ...options, ownerId: "" })).rejects.toMatchObject({ status: 401 });
  });
  it.each(["../qa-book.epub", "..\\qa-book.epub", "C:\\qa-book.epub", "qa-book.epub:stream", ".", "", "qa book.epub"])("rejects unsafe filename %s before any job or filesystem deletion", async (fileName) => {
    const { options, manifestPath } = fixture();
    await expect(deleteOwnedAudiobookBook({ ...options, fileName })).rejects.toMatchObject({ status: 400 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(options.listBookJobs).not.toHaveBeenCalled();
  });
  it.each(["pending", "processing"])("rejects active render %s", async (status) => {
    const { options, manifestPath } = fixture({ renders: { render: { status } } });
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 409 });
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
  it.each(["pending", "processing", "completed-worker"])("rejects active persisted job or live worker %s", async (status) => {
    const { options, manifestPath } = fixture();
    options.listBookJobs.mockReturnValue([{ jobId: "job", job: { status, ownerId: options.ownerId, bookFileName: options.fileName } }]);
    options.isWorkerActive.mockReturnValue(status === "completed-worker");
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 409 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(options.writeCancelMarker).not.toHaveBeenCalled();
  });
  it("checks render-linked jobs and fences completed jobs before removing assets", async () => {
    const { options, manifest, save } = fixture();
    manifest.renders.render.activeJobId = "job"; save();
    options.readJob.mockReturnValue({ status: "completed", ownerId: options.ownerId, bookFileName: options.fileName, renderId: "render" });
    options.writeCancelMarker.mockImplementation(() => {
      expect(fs.existsSync(path.join(options.uploadsDir, options.fileName))).toBe(true);
      return { ok: true };
    });
    await deleteOwnedAudiobookBook(options);
    expect(options.writeCancelMarker).toHaveBeenCalledWith("job", options.ownerId, { renderId: "render", bookFileName: options.fileName });
  });
  it.each([undefined, { status: "completed", ownerId: "foreign", bookFileName: "qa-book.epub" }])("fails closed for unowned or missing recorded jobs", async (job) => {
    const { options, manifest, save, manifestPath } = fixture();
    manifest.renders.render.activeJobId = "job"; save(); options.readJob.mockReturnValue(job);
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(options.audioCacheDir, "qa-final.wav"))).toBe(true);
  });
  it("preserves all assets when job fencing fails", async () => {
    const { options, manifestPath } = fixture();
    options.listBookJobs.mockReturnValue([{ jobId: "job", job: { status: "completed", ownerId: options.ownerId, bookFileName: options.fileName } }]);
    options.writeCancelMarker.mockReturnValue({ ok: false });
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.readdirSync(options.audioCacheDir)).toHaveLength(3);
  });
  it("validates all recorded audio paths before deleting even the first valid audio file", async () => {
    const { options, manifest, save, manifestPath } = fixture();
    manifest.renders.render.chapters.one.audioFileName = "../unrelated.wav"; save();
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(options.audioCacheDir, "qa-final.wav"))).toBe(true);
  });
  it("refuses a mismatched persisted original path", async () => {
    const { options, manifest, save, manifestPath } = fixture();
    manifest.originalPath = path.join(options.uploadsDir, "unrelated.epub"); save();
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
  it("refuses directory assets without recursively removing their contents", async () => {
    const { options, manifestPath } = fixture();
    const audioPath = path.join(options.audioCacheDir, "qa-chapter.wav");
    fs.unlinkSync(audioPath); fs.mkdirSync(audioPath); fs.writeFileSync(path.join(audioPath, "keep"), "keep");
    await expect(deleteOwnedAudiobookBook(options)).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(path.join(audioPath, "keep"))).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
  it("waits for the durable manifest lock and then rechecks persisted ownership", async () => {
    const { options, manifest, save, manifestPath } = fixture();
    let deletion;
    await withAudiobookManifestLock({ manifestDir: options.manifestDir, fileName: options.fileName, run: async () => {
      deletion = deleteOwnedAudiobookBook(options);
      manifest.ownerId = "different-owner"; save();
      expect(fs.existsSync(manifestPath)).toBe(true);
    } });
    await expect(deletion).rejects.toMatchObject({ status: 404 });
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
  it("releases admission and returns the exact safe HTTP contract", async () => {
    const { options } = fixture();
    const release = vi.fn();
    const res = { locals: { releaseAudiobookAdmission: release }, setHeader: vi.fn(), json: vi.fn(), status: vi.fn() };
    res.status.mockReturnValue(res);
    await createDeleteAudiobookBookHandler({ ...options, requestUserId: () => options.ownerId })({ params: { fileName: options.fileName } }, res);
    expect(res.json).toHaveBeenCalledWith({ deleted: true, fileName: options.fileName });
    expect(release).toHaveBeenCalledOnce();
    await createDeleteAudiobookBookHandler({ ...options, requestUserId: () => options.ownerId })({ params: { fileName: options.fileName } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
