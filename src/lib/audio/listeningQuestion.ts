export const AUDIO_LISTENING_QUESTION_EVENT = "studypod:audio-listening-question";

const STORAGE_PREFIX = "studypod:audio-listening-question:";

export type AudioListeningQuestionRequest = {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  chapterId: string;
  chapterTitle: string;
  pageStart?: number;
  pageEnd?: number;
  timeSeconds: number;
  durationSeconds?: number;
  question: string;
};

const cleanSeconds = (seconds: number) =>
  Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));

export const formatListeningTimestamp = (seconds: number) => {
  const totalSeconds = cleanSeconds(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const formatPageRange = (request: AudioListeningQuestionRequest) => {
  if (!request.pageStart) return null;
  if (request.pageEnd && request.pageEnd !== request.pageStart) {
    return `pages ${request.pageStart}–${request.pageEnd}`;
  }
  return `page ${request.pageStart}`;
};

export const buildAudioListeningQuestionMessage = (
  request: AudioListeningQuestionRequest,
) => {
  const pageRange = formatPageRange(request);
  const location = [
    `chapter "${request.chapterTitle}"`,
    `${formatListeningTimestamp(request.timeSeconds)} into the chapter`,
    pageRange,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `I'm listening to "${request.sourceTitle}" at ${location}.`,
    `My question: ${request.question.trim()}`,
    "Answer from this source and cite the relevant passage. If sentence-level audio timing is not available yet, ground the answer to the chapter/page range instead of pretending the timestamp maps to an exact sentence.",
  ].join("\n\n");
};

const storageKey = (notebookId: string) => `${STORAGE_PREFIX}${notebookId}`;

export const queueAudioListeningQuestion = (
  request: AudioListeningQuestionRequest,
) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      storageKey(request.notebookId),
      JSON.stringify(request),
    );
  } catch {
    // The event still provides a best-effort path when session storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<AudioListeningQuestionRequest>(AUDIO_LISTENING_QUESTION_EVENT, {
      detail: request,
    }),
  );
};

export const consumeQueuedAudioListeningQuestion = (
  notebookId?: string,
): AudioListeningQuestionRequest | null => {
  if (!notebookId || typeof window === "undefined") return null;
  const key = storageKey(notebookId);
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
    if (raw) window.sessionStorage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AudioListeningQuestionRequest;
    if (
      !parsed ||
      parsed.notebookId !== notebookId ||
      !parsed.sourceId ||
      !parsed.chapterId ||
      !parsed.question?.trim()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const clearQueuedAudioListeningQuestion = (notebookId?: string) => {
  if (!notebookId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(notebookId));
  } catch {
    // Best effort only.
  }
};
