import path from "node:path";

// Caller supplies the existing manifest lock and durable job tombstone writer.
// Delete audio only: the imported book and its extracted source chapters remain.
export function createDeleteAudiobookAudioHandler({
  requestUserId, sanitizeFileName, mutateOwnedManifest, readJob,
  listBookJobs, isWorkerActive, writeCancelMarker, removeAudioFile, logger,
}) {
  return async (req, res) => {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.params.fileName || "");
    try {
      await mutateOwnedManifest({ fileName, ownerId, mutate: async (manifest) => {
        // A legacy ownerless manifest must never grant destructive access.
        if (!ownerId || manifest.ownerId !== ownerId) {
          throw Object.assign(new Error("Book not found"), { code: "AUDIOBOOK_MANIFEST_FORBIDDEN" });
        }
        const renders = Object.values(manifest.renders || {});
        const jobs = new Map(listBookJobs(fileName, ownerId)
          .map(({ jobId, job }) => [jobId, job]));
        for (const render of renders) {
          if (render.activeJobId) jobs.set(render.activeJobId, readJob(render.activeJobId));
        }
        if (renders.some((render) => ["pending", "processing"].includes(render.status)) ||
            [...jobs].some(([id, job]) => isWorkerActive(id) || ["pending", "processing"].includes(job?.status))) {
          throw Object.assign(new Error("Generation is still active"), { code: "AUDIOBOOK_AUDIO_BUSY" });
        }
        const files = new Set();
        for (const render of renders) {
          if (render.final?.fileName) files.add(render.final.fileName);
          for (const chapter of Object.values(render.chapters || {})) {
            if (chapter.audioFileName) files.add(chapter.audioFileName);
          }
        }
        // Validate all records before the first destructive operation.
        for (const name of files) {
          if (typeof name !== "string" || path.basename(name) !== name || /[\\/]/.test(name)) {
            throw new Error("Invalid recorded audio filename");
          }
        }
        for (const [jobId, job] of jobs) {
          if (!job || job.ownerId !== ownerId || job.bookFileName !== fileName) {
            throw new Error("Recorded audiobook job does not belong to this book");
          }
        }
        // Fence every retry/cache-hit job, including old completed download URLs.
        // Markers share the book lock with final worker publication.
        for (const [jobId, job] of jobs) {
          const result = writeCancelMarker(jobId, ownerId, { renderId: job.renderId, bookFileName: fileName });
          if (!result?.ok) throw new Error("Could not fence audiobook job");
        }
        for (const name of files) await removeAudioFile(name);
        return { ...manifest, renders: {}, activeRenderId: null, listenerState: null, bookmarks: [] };
      }});
      res.setHeader("Cache-Control", "no-store");
      return res.json({ deleted: true });
    } catch (error) {
      if (["AUDIOBOOK_MANIFEST_NOT_FOUND", "AUDIOBOOK_MANIFEST_FORBIDDEN"].includes(error?.code)) {
        return res.status(404).json({ error: "Book not found" });
      }
      if (error?.code === "AUDIOBOOK_AUDIO_BUSY") {
        return res.status(409).json({ error: "Cancel generation and wait for its worker to stop before deleting saved audio" });
      }
      logger.error("Could not delete saved audiobook audio:", error);
      return res.status(500).json({ error: "Could not delete saved audiobook audio" });
    } finally {
      res.locals?.releaseAudiobookAdmission?.();
    }
  };
}
