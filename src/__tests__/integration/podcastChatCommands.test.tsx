import React, { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PodcastView from '@/components/notebook/PodcastView';
import { parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
const mock = vi.hoisted(() => ({
    script: vi.fn(), start: vi.fn(), cancel: vi.fn(), toast: vi.fn(), save: vi.fn(),
    sources: [
        { id: 'selected', notebook_id: 'notebook-a', title: 'Selected evidence', type: 'text', processing_status: 'ready', content: 'SELECTED_SOURCE: Controlled fixture explains the solar system. '.repeat(8), created_at: '2026-09-29T12:00:00Z', updated_at: '2026-09-29T12:00:00Z' },
        { id: 'excluded', notebook_id: 'notebook-a', title: 'Excluded evidence', type: 'text', processing_status: 'ready', content: 'EXCLUDED_SECRET_FIXTURE: This must not enter a selected-source podcast. '.repeat(8), created_at: '2026-09-29T12:00:00Z', updated_at: '2026-09-29T12:00:00Z' },
    ],
    notes: [{ id: 'note', content: 'UNSELECTED_NOTE_FIXTURE' }],
    history: [],
    generator: null as unknown,
}));
vi.mock('@/hooks/useSources', () => ({ useSources: () => ({ sources: mock.sources }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ notes: mock.notes }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock('@/hooks/usePodcastHistory', () => ({ usePodcastHistory: () => ({ podcasts: mock.history, savePodcast: mock.save }) }));
vi.mock('@/lib/podcastGenerator', () => ({ generatePodcastScript: mock.script }));
vi.mock('@/lib/tts/streamingTTSGenerator', () => ({ getStreamingTTSGenerator: () => mock.generator }));
vi.mock('@/lib/tts/podcastAudioGenerator', () => ({
    getPodcastAudioConfig: () => ({ host1Voice: 'am_onyx', host2Voice: 'af_nova', speed: 1, pauseBetweenSegments: 300 }),
    savePodcastAudioConfig: vi.fn(),
}));
vi.mock('@/lib/tts/kokoroTTSProvider', () => ({ KOKORO_VOICES: { am_onyx: { gender: 'male', name: 'Alex' }, af_nova: { gender: 'female', name: 'Sarah' } } }));
vi.mock('@/lib/tts/audioValidator', () => ({ AudioValidator: { validateBlob: vi.fn() } }));
vi.mock('@/components/notebook/TTSProviderSettings', () => ({ default: () => null }));
vi.mock('@/components/notebook/TTSSettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/notebook/AudioPlayer', () => ({ default: () => null }));
vi.mock('@/components/notebook/PodcastHistory', () => ({ PodcastHistory: () => null }));
vi.mock('@/services/indexedDBService', () => ({ indexedDBService: {} }));
const script = () => ({ title: 'Fixture podcast', segments: [{ speaker: 'Alex', text: 'The solar system fixture.' }, { speaker: 'Sarah', text: 'What does it include?' }] });
const command = (message: string, sourceIds = ['selected'], notebookId = 'notebook-a') => {
    const store = useStudioAudioCommands.getState();
    expect(store.draft(notebookId, parseStudioAudioIntent(message)!)).toBe(true);
    const id = useStudioAudioCommands.getState().requests[notebookId].id;
    expect(store.queue(notebookId, id, sourceIds)).toBe(true);
    return id;
};
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStudioAudioCommands.setState({ requests: {} });
    usePodcastGenerationStore.setState({ isGenerating: false, progress: null, script: null, notebookId: null, audioUrl: null, partialAudioUrls: [], podcastId: null });
    mock.generator = { startStreaming: mock.start, cancel: mock.cancel, stopPlayback: vi.fn(), isRunning: () => false, isUsingKokoro: () => true };
    mock.start.mockResolvedValue(undefined);
    mock.script.mockResolvedValue(script());
});
afterEach(() => { cleanup(); usePodcastGenerationStore.setState({ isGenerating: false, script: null, notebookId: null }); });
describe('chat -> existing Podcast Studio handler (mocked providers, real components)', () => {
    it('generates once in StrictMode from exactly the confirmed sources and focus', async () => {
        render(<StrictMode><PodcastView notebookId="notebook-a"/></StrictMode>);
        act(() => { command('Make a podcast about planetary orbits'); });
        await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
        expect(mock.script).toHaveBeenCalledTimes(1);
        const [content, options] = mock.script.mock.calls[0];
        expect(content).toContain('SELECTED_SOURCE');
        expect(content).not.toContain('EXCLUDED_SECRET_FIXTURE');
        expect(options.userNotes).toContain('planetary orbits');
        expect(options.userNotes).not.toContain('UNSELECTED_NOTE_FIXTURE');
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('accepted');
    });
    it('rejects a stale or foreign source selection instead of falling back to all sources', async () => {
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast', ['foreign-source']); });
        await waitFor(() => expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('failed'));
        expect(mock.script).not.toHaveBeenCalled();
        expect(mock.start).not.toHaveBeenCalled();
    });
    it('does not consume another notebook command', async () => {
        render(<PodcastView notebookId="notebook-b"/>);
        act(() => { command('Make a podcast'); });
        await act(async () => { });
        expect(mock.script).not.toHaveBeenCalled();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('queued');
    });
    it('cancels during script preparation and discards its late result before synthesis', async () => {
        let resolveScript!: (value: ReturnType<typeof script>) => void;
        mock.script.mockReturnValueOnce(new Promise((resolve) => { resolveScript = resolve; }));
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast'); });
        await waitFor(() => expect(mock.script).toHaveBeenCalledTimes(1));
        act(() => { command('Cancel my podcast', []); });
        await waitFor(() => expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('accepted'));
        await act(async () => { resolveScript(script()); });
        expect(mock.start).not.toHaveBeenCalled();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].operation).toBe('cancel');
    });
    it('ignores old progress callbacks after cancellation and a different notebook becomes active', async () => {
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast'); });
        await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
        const progressCallback = mock.start.mock.calls[0][2];
        act(() => { command('Cancel my podcast', []); });
        await waitFor(() => expect(mock.cancel).toHaveBeenCalledTimes(1));
        act(() => { usePodcastGenerationStore.getState().startGeneration('notebook-b', script()); });
        act(() => { progressCallback({ phase: 'complete', percentage: 100, message: 'Stale success', currentSegment: 2, totalSegments: 2, canPlay: true }); });
        expect(usePodcastGenerationStore.getState().notebookId).toBe('notebook-b');
        expect(usePodcastGenerationStore.getState().progress?.message).toBe('Starting generation...');
    });
});
