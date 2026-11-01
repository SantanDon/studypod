import { beforeEach, describe, expect, it } from 'vitest';
import { useAudiobookStore } from '@/stores/audiobookStore';

beforeEach(() => {
  localStorage.clear();
  useAudiobookStore.setState({ includeFraming: false });
});

describe('audiobook framing preference', () => {
  it('defaults to faithful source-only narration and persists explicit opt-in', () => {
    expect(useAudiobookStore.getState().includeFraming).toBe(false);

    useAudiobookStore.getState().setIncludeFraming(true);

    expect(useAudiobookStore.getState().includeFraming).toBe(true);
    const saved = JSON.parse(localStorage.getItem('studypod:audiobook-workspace') || '{}');
    expect(saved.state.includeFraming).toBe(true);
  });
});
