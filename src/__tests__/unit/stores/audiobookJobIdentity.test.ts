import { beforeEach, describe, expect, it } from 'vitest';
import { useAudiobookStore, type AudiobookJob } from '@/stores/audiobookStore';

const job = (jobId: string): AudiobookJob => ({
  jobId, bookId: 'fixture-book', notebookId: 'fixture-notebook',
  bookTitle: 'Original fixture', bookFileName: 'fixture.txt',
  status: 'processing', progress: 10, outputFormat: 'mp3',
  provider: 'fixture', voice: 'fixture', style: 'faithful',
});

beforeEach(() => {
  localStorage.clear();
  useAudiobookStore.setState({ jobs: {} });
});

describe('audiobook asynchronous response identity', () => {
  it('does not let an old cancellation response overwrite a newer execution', () => {
    const store = useAudiobookStore.getState();
    store.upsertJob(job('first'));
    store.upsertJob(job('retry'));
    store.updateJob('fixture-book', { status: 'cancelled', progress: 0 }, 'first');
    expect(useAudiobookStore.getState().jobs['fixture-book']).toMatchObject({ jobId: 'retry', status: 'processing', progress: 10 });
  });

  it('does not let a late missing-job response delete a retry', () => {
    const store = useAudiobookStore.getState();
    store.upsertJob(job('retry'));
    store.clearJob('fixture-book', 'first');
    expect(useAudiobookStore.getState().jobs['fixture-book'].jobId).toBe('retry');
  });

  it('updates the expected execution and clears its invalid full-download URL', () => {
    const store = useAudiobookStore.getState();
    store.upsertJob({ ...job('first'), url: '/fixture-old-download' });
    store.updateJob('fixture-book', { status: 'cancelled', url: undefined, workerActive: true }, 'first');
    expect(useAudiobookStore.getState().jobs['fixture-book']).toMatchObject({ jobId: 'first', status: 'cancelled', workerActive: true });
    expect(useAudiobookStore.getState().jobs['fixture-book'].url).toBeUndefined();
  });

  it('clears only the expected execution', () => {
    const store = useAudiobookStore.getState();
    store.upsertJob(job('first'));
    store.clearJob('fixture-book', 'first');
    expect(useAudiobookStore.getState().jobs['fixture-book']).toBeUndefined();
  });

  it('does not recreate a removed job from a delayed response', () => {
    const store = useAudiobookStore.getState();
    store.updateJob('fixture-book', { status: 'completed' }, 'gone');
    expect(useAudiobookStore.getState().jobs).toEqual({});
  });

  it('preserves existing synchronous update and clear callers', () => {
    const store = useAudiobookStore.getState();
    store.upsertJob(job('first'));
    store.updateJob('fixture-book', { progress: 25 });
    expect(useAudiobookStore.getState().jobs['fixture-book'].progress).toBe(25);
    store.clearJob('fixture-book');
    expect(useAudiobookStore.getState().jobs).toEqual({});
  });
});
