import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudiobookStore } from '@/stores/audiobookStore';

beforeEach(() => {
  localStorage.clear();
  useAudiobookStore.setState({ includeFraming: false, currentBookId: null });
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

describe('audiobook book selection', () => {
  it('does not publish a store update when clearing an already empty selection', () => {
    const listener = vi.fn();
    const unsubscribe = useAudiobookStore.subscribe(listener);

    useAudiobookStore.getState().setCurrentBookId(null);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
