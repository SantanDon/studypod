import path from "node:path";

/**
 * Reuse the compressed full export for chapter playback only when it is
 * unambiguously the same single-chapter render. Multi-chapter renders keep
 * their chapter WAVs so selecting a chapter never starts at the book's start.
 */
export const resolveCompactChapterPlaybackAsset = ({
  render,
  chapterId,
  cacheDir,
  isUsableAudioFile,
}) => {
  const chapter = render?.chapters?.[chapterId];
  if (chapter?.status !== "completed" || !chapter.audioFileName) return null;

  const playableChapters = Object.entries(render.chapters || {}).filter(
    ([, candidate]) =>
      candidate?.status === "completed" && Boolean(candidate.audioFileName),
  );
  if (playableChapters.length !== 1 || playableChapters[0][0] !== chapterId) {
    return null;
  }

  const final = render.final;
  const fileName = final?.fileName;
  if (
    final?.status !== "completed" ||
    String(final.format || "").toLowerCase() !== "mp3" ||
    !fileName ||
    path.basename(fileName) !== fileName
  ) {
    return null;
  }

  const duration = Number(chapter.durationSeconds);
  const finalDuration = Number(final.durationSeconds);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(finalDuration) ||
    Math.abs(duration - finalDuration) > 1
  ) {
    return null;
  }

  const filePath = path.join(cacheDir, fileName);
  if (!isUsableAudioFile(filePath)) return null;
  return { filePath, contentType: "audio/mpeg" };
};
