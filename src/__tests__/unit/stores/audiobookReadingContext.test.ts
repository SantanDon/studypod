import { beforeEach, describe, expect, it } from 'vitest';
import { useAudiobookStore } from '@/stores/audiobookStore';

const readingContext = {
  audiobookId: 'audio-1',
  sourceId: 'source-1',
  bookTitle: 'The Long Road',
  chapterId: 'chapter-3',
  chapterIndex: 2,
  chapterCount: 8,
  chapterTitle: 'A New Start',
  progressPercent: 24,
  isPlaying: false,
};

beforeEach(() => {
  localStorage.clear();
  useAudiobookStore.setState({ readingContextByNotebook: {} });
});

describe('audiobook reading context persistence', () => {
  it('persists validated reading context so chapter prompts survive reload', () => {
    useAudiobookStore.getState().setReadingContext('notebook-1', readingContext);

    expect(useAudiobookStore.getState().readingContextByNotebook['notebook-1']).toEqual(readingContext);
    const saved = JSON.parse(localStorage.getItem('studypod:audiobook-workspace') || '{}');
    expect(saved.version).toBe(6);
    expect(saved.state.readingContextByNotebook).toEqual({ 'notebook-1': readingContext });
  });

  it('restores same-version context during hydration', async () => {
    localStorage.setItem('studypod:audiobook-workspace', JSON.stringify({
      state: {
        selectedVoice: 'immersive_narrator',
        selectedStyle: 'auto',
        outputFormat: 'mp3',
        selectedProvider: 'kokoro',
        notebookId: 'notebook-1',
        jobs: {},
        pronunciationsByBook: {},
        readingContextByNotebook: { 'notebook-1': readingContext },
      },
      version: 6,
    }));

    await useAudiobookStore.persist.rehydrate();

    expect(useAudiobookStore.getState().readingContextByNotebook).toEqual({ 'notebook-1': readingContext });
    const saved = JSON.parse(localStorage.getItem('studypod:audiobook-workspace') || '{}');
    expect(saved.version).toBe(6);
    expect(saved.state.readingContextByNotebook).toEqual({ 'notebook-1': readingContext });
  });

  it('discards older saved context until the current player validates it', async () => {
    localStorage.setItem('studypod:audiobook-workspace', JSON.stringify({
      state: { notebookId: 'notebook-1', readingContextByNotebook: { 'notebook-1': readingContext } },
      version: 5,
    }));

    await useAudiobookStore.persist.rehydrate();

    expect(useAudiobookStore.getState().readingContextByNotebook).toEqual({});
  });
});
