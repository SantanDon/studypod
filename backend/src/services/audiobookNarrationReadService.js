import { isSupportedBookFile, sanitizeFileName } from "./audiobookBookService.js";
import { isOwnedAudiobookManifest } from "./audiobookRequestGuard.js";

// Deliberately one chapter per request: never expose internal manifest paths or jobs.
export function createAudiobookNarrationReadHandler({ requestUserId, loadManifest }) {
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ownerId = requestUserId(req);
    if (!ownerId) return res.status(401).json({ error: "Authentication required" });
    const { fileName, chapterId } = req.params;
    const renderId = req.query.renderId;
    if (typeof fileName !== "string" || fileName.length > 255 ||
        sanitizeFileName(fileName) !== fileName || /[\\/]/.test(fileName) || !isSupportedBookFile(fileName) ||
        typeof chapterId !== "string" || !chapterId || chapterId.length > 255 ||
        typeof renderId !== "string" || !renderId || renderId.length > 255) {
      return res.status(400).json({ error: "Invalid narration request" });
    }
    try {
      const manifest = loadManifest(fileName);
      if (!isOwnedAudiobookManifest(manifest, ownerId) || manifest.fileName !== fileName) {
        return res.status(404).json({ error: "Book not found" });
      }
      const render = Object.hasOwn(manifest.renders || {}, renderId) ? manifest.renders[renderId] : null;
      const rendered = render && Object.hasOwn(render.chapters || {}, chapterId) ? render.chapters[chapterId] : null;
      const chapter = manifest.chapters?.find(item => item.id === chapterId);
      if (!chapter || rendered?.status !== "completed") {
        return res.status(404).json({ error: "Rendered chapter not found" });
      }
      const narrationText = chapter.narrationText || chapter.text || "";
      if (typeof narrationText !== "string" || !narrationText) {
        return res.status(404).json({ error: "Narration not found" });
      }
      const result = { fileName, renderId, chapterId, narrationText };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024) {
        return res.status(413).json({ error: "Narration chapter exceeds response limit" });
      }
      return res.json(result);
    } catch {
      return res.status(500).json({ error: "Could not read saved narration" });
    }
  };
}
