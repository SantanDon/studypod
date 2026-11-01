import { describe, expect, it } from 'vitest';
import { getAudiobookChapterScope, getPlayableChapterPosition, getReadingFollowUpPrompts, getVisibleChatQuestion, withAudiobookReadingContext } from '@/lib/audio/readingContext';
import type { AudiobookPlaybackManifest } from '@/lib/audio/audiobookPlayback';
import type { AudiobookReadingContext } from '@/stores/audiobookStore';
import { resolveChatSourceIds, resolveUsableAudiobookReadingContext } from '@/components/notebook/ChatArea';

const context: AudiobookReadingContext = {
  audiobookId: 'audio-1',
  sourceId: 'source-1',
  bookTitle: 'The Long Road',
  chapterId: 'chapter-2',
  chapterIndex: 1,
  chapterCount: 8,
  chapterTitle: 'A New Start',
  progressPercent: 24.6,
  isPlaying: true,
};

describe('audiobook reading context for chat', () => {
  it('grounds ordinary chapter-aware chat in its usable reading source unless the user chose a scope', () => {
    expect(resolveChatSourceIds({
      chatScope: 'all',
      hasExplicitAllScope: false,
      readingSourceId: 'book-i-source',
      readingSourceUsable: true,
    })).toEqual(['book-i-source']);
    expect(resolveChatSourceIds({
      chatScope: 'active',
      activeSourceId: 'selected-source',
      hasExplicitAllScope: false,
      readingSourceId: 'book-i-source',
      readingSourceUsable: true,
    })).toEqual(['selected-source']);
    expect(resolveChatSourceIds({
      chatScope: 'all',
      hasExplicitAllScope: true,
      readingSourceId: 'book-i-source',
      readingSourceUsable: true,
    })).toBeUndefined();
    expect(resolveChatSourceIds({
      explicitSourceIds: ['requested-source'],
      chatScope: 'all',
      hasExplicitAllScope: false,
      readingSourceId: 'book-i-source',
      readingSourceUsable: true,
    })).toEqual(['requested-source']);
    expect(resolveChatSourceIds({
      chatScope: 'all',
      hasExplicitAllScope: false,
      readingSourceId: 'processing-source',
      readingSourceUsable: false,
    })).toBeUndefined();
  });

  it('does not append stale chapter metadata when its source is unavailable or unusable', () => {
    const question = 'Explain this passage';

    for (const sourceUsable of [false]) {
      const contextForSubmission = resolveUsableAudiobookReadingContext(context, sourceUsable);
      expect(contextForSubmission).toBeUndefined();
      expect(withAudiobookReadingContext(question, contextForSubmission)).toBe(question);
      expect(resolveChatSourceIds({
        chatScope: 'all',
        hasExplicitAllScope: false,
        readingSourceId: context.sourceId,
        readingSourceUsable: sourceUsable,
      })).toBeUndefined();
    }

    const validContext = resolveUsableAudiobookReadingContext(context, true);
    expect(validContext).toBe(context);
    expect(withAudiobookReadingContext(question, validContext)).toContain('audio segment 2 of 8');
  });

  it('does not count structural book chapters as rendered audio chapters', () => {
    const manifest = {
      chapters: Array.from({ length: 13 }, (_, index) => ({
        id: `item${index}`,
        narratable: true,
        audioUrl: index === 12 ? '/audio/book-i.mp3' : null,
      })),
    } as AudiobookPlaybackManifest;

    expect(getPlayableChapterPosition(manifest, 'item12')).toEqual({
      chapterIndex: 0,
      chapterCount: 1,
    });
    expect(getPlayableChapterPosition(manifest, 'item0')).toBeNull();
  });

  it('keeps navigation metadata out of document-heading ordinal syntax and hides it from the visible question', () => {
    const question = 'What does this reveal?';
    const submitted = withAudiobookReadingContext(question, context);
    expect(submitted.startsWith(question)).toBe(true);
    expect(submitted).toContain('audio segment 2 of 8 “A New Start”');
    expect(submitted).toContain('25% through the audiobook; playing');
    expect(submitted).toContain('navigation metadata, not source evidence');
    expect(submitted).toContain('do not invent excerpts');
    expect(submitted).not.toMatch(/\b(?:book|chapter|section)\s+(?:\d+|[ivxlcdm]+)\b/i);
    expect(getVisibleChatQuestion(submitted)).toBe(question);
  });

  it('sanitizes ordinal-looking titles so metadata cannot accidentally request a document heading', () => {
    const submitted = withAudiobookReadingContext('Explain this', {
      ...context,
      bookTitle: 'Book 3: Examples',
      chapterTitle: 'Chapter IV: The Section 2 Test',
    });
    expect(submitted).toContain('reading section: Examples');
    expect(submitted).toContain('reading section: The reading section Test');
    expect(submitted).not.toMatch(/\b(?:book|chapter|section)\s+(?:\d+|[ivxlcdm]+)\b/i);
    expect(getAudiobookChapterScope(submitted)).toBeUndefined();
  });

  it('keeps an exact arbitrary section title in encoded app metadata for follow-up retrieval', () => {
    const submitted = withAudiobookReadingContext('What exactly do these notes say?', {
      ...context,
      chapterTitle: 'Chapter IV: Transcriber’s Notes',
    });
    expect(submitted).toContain(`Audiobook section title (encoded): ${encodeURIComponent('Chapter IV: Transcriber’s Notes')}`);
    expect(submitted).not.toContain('Audiobook section title (encoded): Chapter IV');
    expect(getVisibleChatQuestion(submitted)).toBe('What exactly do these notes say?');
  });

  it('preserves only an exact structural chapter identifier as a private evidence scope', () => {
    const submitted = withAudiobookReadingContext('Explain this passage', {
      ...context,
      chapterTitle: 'Book I',
    });

    expect(submitted).toContain('Structural section: Book I.');
    expect(getAudiobookChapterScope(submitted)).toBe('Book I');
    expect(getVisibleChatQuestion(submitted)).toBe('Explain this passage');
    expect(getAudiobookChapterScope(withAudiobookReadingContext('Explain', {
      ...context,
      chapterTitle: 'Book I: Introduction',
    }))).toBeUndefined();
  });

  it('recognizes a structural manifest title with a display-only trailing period', () => {
    const submitted = withAudiobookReadingContext('Ask me a practice question', {
      ...context,
      chapterTitle: 'Book I.',
    });

    expect(submitted).toContain('Structural section: Book I.');
    expect(getAudiobookChapterScope(submitted)).toBe('Book I');
    expect(getAudiobookChapterScope(withAudiobookReadingContext('Explain', {
      ...context,
      chapterTitle: 'Book I: Introduction.',
    }))).toBeUndefined();
  });

  it('leaves questions unchanged when there is no reading context', () => {
    expect(withAudiobookReadingContext('Explain this')).toBe('Explain this');
    expect(getVisibleChatQuestion('Explain this')).toBe('Explain this');
  });

  it('suggests useful chapter-aware follow-ups without claiming chapter text is available', () => {
    const prompts = getReadingFollowUpPrompts(context);
    expect(prompts).toHaveLength(4);
    expect(prompts.every((prompt) => prompt.includes('“A New Start”'))).toBe(true);
    expect(prompts[1]).toContain('available source evidence');
  });
});
