import { beforeEach, describe, expect, it, vi } from 'vitest';
const generator = vi.hoisted(() => ({ isRunning: vi.fn(() => false), cancel: vi.fn() }));
vi.mock('@/lib/tts/streamingTTSGenerator', () => ({ getStreamingTTSGenerator: () => generator }));
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
const script = { title: 'Original fixture', segments: [{ speaker: 'Host', text: 'This is permitted test content.' }] };
beforeEach(() => {
  localStorage.clear(); generator.isRunning.mockReturnValue(false);
  usePodcastGenerationStore.setState({ isGenerating: false, notebookId: null, script: null, progress: null, audioUrl: null, podcastId: null, partialAudioUrls: [], canPlayPartial: false });
});
const save = (data: Record<string, unknown>) => localStorage.setItem('active_podcast_fixture', JSON.stringify({ notebookId: 'fixture', script, timestamp: Date.now(), ...data }));
describe('validated interrupted podcast recovery', () => {
  it.each([null, {}, { title: 12, segments: [] }, { title: 'Bad', segments: [null] }, { title: 'Bad', segments: [{ speaker: 12, text: 'No' }] }, { title: 'Bad', segments: [{ speaker: 'Host', text: {} }] }, { ...script, metadata: { host1Name: 12 } }])('rejects malformed persisted scripts without claiming playback: %j', (bad) => {
    save({ script: bad });
    expect(usePodcastGenerationStore.getState().rehydrateState('fixture')).toBe(false);
    expect(usePodcastGenerationStore.getState()).toMatchObject({ isGenerating: false, script: null, canPlayPartial: false, audioUrl: null });
  });
  it('rejects a future timestamp instead of treating it as a fresh active session', () => {
    save({ timestamp: Date.now() + 3_600_000 });
    expect(usePodcastGenerationStore.getState().rehydrateState('fixture')).toBe(false);
    expect(usePodcastGenerationStore.getState().script).toBeNull();
  });
  it('uses supported setting defaults while preserving a valid draft', () => {
    save({ podcastType: { invalid: true }, podcastFormat: 'unknown', host1Name: 123 });
    expect(usePodcastGenerationStore.getState().rehydrateState('fixture')).toBe(false);
    expect(usePodcastGenerationStore.getState()).toMatchObject({ script, podcastType: 'standard', podcastFormat: 'dialogue', host1Name: 'Alex', isGenerating: false, canPlayPartial: false });
  });
  it('does not attach another notebook final artifact to an interrupted draft', () => {
    usePodcastGenerationStore.setState({ notebookId: 'previous', audioUrl: 'blob:previous-final', podcastId: 'previous-artifact' });
    save({ partialAudioUrls: ['blob:expired', 'https://untrusted.example/audio'] });
    expect(usePodcastGenerationStore.getState().rehydrateState('fixture')).toBe(false);
    expect(usePodcastGenerationStore.getState()).toMatchObject({ notebookId: 'fixture', script, audioUrl: null, podcastId: null, partialAudioUrls: [], canPlayPartial: false });
  });
});
