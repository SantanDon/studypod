import fs from "node:fs";
import path from "node:path";
import { isSupportedBookFile, loadBookManifest, manifestPathFor, sanitizeFileName } from "./audiobookBookService.js";
import { withAudiobookManifestLock } from "./audiobookManifestService.js";

const failure = (status, message) => Object.assign(new Error(message), { status });
const active = (status) => ["pending", "processing"].includes(status);

function exactFile(directory, name) {
  if (typeof name !== "string" || !name || name === "." || name === ".." ||
      !/^[a-zA-Z0-9._-]+$/.test(name) || path.basename(name) !== name) {
    throw failure(500, "Invalid recorded audiobook filename");
  }
  const target = path.resolve(directory, name);
  if (path.dirname(target) !== path.resolve(directory)) throw failure(500, "Invalid audiobook path");
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw failure(500, "Audiobook asset is not a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return target;
}

export async function deleteOwnedAudiobookBook({
  fileName, ownerId, uploadsDir, manifestDir, audioCacheDir,
  listBookJobs, readJob, isWorkerActive, writeCancelMarker,
}) {
  if (!ownerId) throw failure(401, "Authentication required");
  if (typeof fileName !== "string" || !fileName || fileName.length > 255 ||
      sanitizeFileName(fileName) !== fileName || /[\\/]/.test(fileName) || !isSupportedBookFile(fileName)) {
    throw failure(400, "Invalid audiobook filename");
  }
  return withAudiobookManifestLock({ manifestDir, fileName, run: async () => {
    const manifestPath = exactFile(manifestDir, path.basename(manifestPathFor(manifestDir, fileName)));
    const manifest = loadBookManifest(manifestDir, fileName);
    if (!manifest || manifest.ownerId !== ownerId || manifest.fileName !== fileName) {
      throw failure(404, "Book not found");
    }
    const renders = Object.values(manifest.renders || {});
    const jobs = new Map(listBookJobs(fileName, ownerId).map(({ jobId, job }) => [jobId, job]));
    for (const render of renders) {
      if (render.activeJobId) jobs.set(render.activeJobId, readJob(render.activeJobId));
    }
    if (renders.some((render) => active(render.status)) ||
        [...jobs].some(([jobId, job]) => isWorkerActive(jobId) || active(job?.status))) {
      throw failure(409, "Cancel generation and wait for its worker to stop before deleting this book");
    }
    for (const [, job] of jobs) {
      if (!job || job.ownerId !== ownerId || job.bookFileName !== fileName) {
        throw failure(500, "Recorded audiobook job does not belong to this book");
      }
    }
    const uploadPath = exactFile(uploadsDir, fileName);
    if (manifest.originalPath && path.resolve(manifest.originalPath) !== uploadPath) {
      throw failure(500, "Recorded audiobook upload path does not match this book");
    }
    const audioNames = new Set();
    for (const render of renders) {
      if (render.final?.fileName) audioNames.add(render.final.fileName);
      for (const chapter of Object.values(render.chapters || {})) {
        if (chapter.audioFileName) audioNames.add(chapter.audioFileName);
      }
    }
    const audioPaths = [...audioNames].map((name) => exactFile(audioCacheDir, name));
    // Keep job tombstones so old download URLs cannot revive deleted assets.
    for (const [jobId, job] of jobs) {
      if (!writeCancelMarker(jobId, ownerId, { renderId: job.renderId, bookFileName: fileName })?.ok) {
        throw failure(500, "Could not fence audiobook job");
      }
    }
    for (const target of [...audioPaths, uploadPath, manifestPath]) {
      try { fs.unlinkSync(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return { deleted: true, fileName };
  } });
}

export function createDeleteAudiobookBookHandler(options) {
  return async (req, res) => {
    try {
      const result = await deleteOwnedAudiobookBook({ ...options, fileName: req.params.fileName, ownerId: options.requestUserId(req) });
      res.setHeader("Cache-Control", "no-store");
      return res.json(result);
    } catch (error) {
      if (!error.status) options.logger?.error("Audiobook book deletion failed:", error);
      const status = error.status || 500;
      return res.status(status).json({ error: status === 500 ? "Could not delete audiobook" : error.message });
    } finally {
      res.locals?.releaseAudiobookAdmission?.();
    }
  };
}
