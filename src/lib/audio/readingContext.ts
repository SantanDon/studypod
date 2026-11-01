import type { AudiobookReadingContext } from '@/stores/audiobookStore';
import type { AudiobookPlaybackManifest } from '@/lib/audio/audiobookPlayback';

/**
 * Resolve position only within chapters that have a real audio asset in this
 * render. The manifest may also contain structural or not-yet-rendered book
 * chapters, which must not make one rendered chapter look like part of a
 * complete multi-chapter audiobook.
 */
export const getPlayableChapterPosition = (
  manifest: AudiobookPlaybackManifest,
  chapterId: string,
): { chapterIndex: number; chapterCount: number } | null => {
  const playableChapters = manifest.chapters.filter(
    (chapter) => chapter.narratable !== false && Boolean(chapter.audioUrl),
  );
  const chapterIndex = playableChapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) return null;
  return { chapterIndex, chapterCount: playableChapters.length };
};

const safeLabel = (value: string): string => value
  .replace(/\b(?:book|chapter|section)\s+(?:\d+|[ivxlcdm]+)\b/gi, 'reading section')
  .replace(/[\r\n[\]]/g, ' ')
  .trim();

/** Only canonical structural labels can narrow evidence; arbitrary titles stay descriptive. */
const getStructuralChapterIdentifier = (value?: string): string | undefined => {
  // Manifest chapter titles may include a sentence-ending period even when
  // the player displays the normalized structural label (for example,
  // "Book I." is shown as "Book I"). Normalize that punctuation before
  // deciding whether this is a safe, exact structural scope.
  const normalized = value?.trim().replace(/[.:]+$/, '').trim();
  const match = normalized?.match(/^(book|chapter)\s+(\d+|[ivxlcdm]+)$/i);
  if (!match) return undefined;
  const kind = match[1].toLowerCase() === 'book' ? 'Book' : 'Chapter';
  const identifier = match[2].toUpperCase();
  return `${kind} ${identifier}`;
};

/** Read a structural scope from the internal suffix, never from the visible user question. */
export const getAudiobookChapterScope = (content: string): string | undefined => {
  const suffix = content.match(/\n\n\[Reader position: ([\s\S]*?)\]$/)?.[1];
  const scope = suffix?.match(/\bStructural section: (Book|Chapter) (\d+|[IVXLCDM]+)\./i);
  return scope ? getStructuralChapterIdentifier(`${scope[1]} ${scope[2]}`) : undefined;
};

/**
 * Adds playback position as navigation context only. It is not source evidence
 * and does not imply that the model has the narrated passage available. Avoid
 * ordinal forms such as "chapter 3" here: evidence selection treats those as
 * explicit requests for a matching document heading.
 */
export const withAudiobookReadingContext = (
  question: string,
  context?: AudiobookReadingContext,
): string => {
  if (!context) return question;
  // Ask-about-this-point questions already carry the position captured when
  // they were created. Keep that scope instead of appending a newer playback
  // position (which could silently replace the chapter used for retrieval).
  if (/\n\n\[Reader position: [\s\S]*?\]$/.test(question)) return question;

  const segment = context.chapterCount
    ? `audio segment ${context.chapterIndex + 1} of ${context.chapterCount}`
    : `audio segment ${context.chapterIndex + 1}`;
  const label = context.chapterTitle ? ` “${safeLabel(context.chapterTitle)}”` : '';
  const progress = typeof context.progressPercent === 'number'
    ? `, ${Math.round(context.progressPercent)}% through the audiobook`
    : '';
  const title = context.bookTitle ? ` in “${safeLabel(context.bookTitle)}”` : '';
  const chapterScope = getStructuralChapterIdentifier(context.chapterTitle);
  const scope = chapterScope ? ` Structural section: ${chapterScope}.` : '';
  // Keep the exact manifest title in private app metadata so follow-up turns
  // can retrieve the same titled section. Do not derive this scope from the
  // learner's wording; the backend accepts it only from this generated block.
  const exactTitle = context.chapterTitle
    ?.replace(/[\r\n[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const titleScope = exactTitle ? `\nAudiobook section title (encoded): ${encodeURIComponent(exactTitle)}` : '';

  return `${question}\n\n[Reader position: ${segment}${label}${title}${progress}; ${context.isPlaying ? 'playing' : 'paused'}.${scope}${titleScope}\nThis is navigation metadata, not source evidence. Use only source text available in the notebook; do not invent excerpts or assume access to the exact passage.]`;
};

export const getReadingFollowUpPrompts = (context?: AudiobookReadingContext): string[] => {
  const chapter = context?.chapterTitle ? `“${context.chapterTitle}”` : 'the current chapter';
  return [
    `Help me connect ${chapter} to the sources in my notebook.`,
    `What should I focus on in ${chapter}? Use only available source evidence.`,
    `Ask me one question to check my understanding of ${chapter}.`,
    `What is still unclear about ${chapter} based on my notebook sources?`,
  ];
};

/** Hides only app-generated audiobook context blocks, never ordinary question text. */
export const getVisibleChatQuestion = (content: string): string => {
  let visible = content;
  const readerMarker = '\n\n[Reader position: ';
  const readerStart = visible.lastIndexOf(readerMarker);
  if (readerStart >= 0) {
    const readerBlock = visible.slice(readerStart);
    if (readerBlock.endsWith(']') && readerBlock.includes('This is navigation metadata, not source evidence.')) {
      visible = visible.slice(0, readerStart);
    }
  }

  const audioMarker = '\n\n[Audio listening context:\n';
  const audioStart = visible.lastIndexOf(audioMarker);
  if (audioStart >= 0) {
    const audioBlock = visible.slice(audioStart);
    if (
      audioBlock.endsWith(']') &&
      audioBlock.includes('\nBook: ') &&
      audioBlock.includes('\nPosition: ') &&
      audioBlock.includes('Answer from this source and cite the relevant passage.')
    ) {
      visible = visible.slice(0, audioStart);
    }
  }
  return visible;
};
