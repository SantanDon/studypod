import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PodcastView from '@/components/notebook/PodcastView';
import { parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
import { AudioValidator, type AudioValidationResult } from '@/lib/tts/audioValidator';
const mock = vi.hoisted(() => ({
    script: vi.fn(), start: vi.fn(), cancel: vi.fn(), toast: vi.fn(), save: vi.fn(), loadAudio: vi.fn(), assertCurrent: vi.fn(),
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
vi.mock('@/hooks/usePodcastHistory', () => ({ usePodcastHistory: () => ({ podcasts: mock.history, savePodcast: mock.save, loadAudio: mock.loadAudio, scopeKey: 'fixture:notebook-a', assertCurrent: mock.assertCurrent }) }));
vi.mock('@/lib/podcastGenerator', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/podcastGenerator')>()),
    generatePodcastScript: mock.script,
}));
vi.mock('@/lib/tts/streamingTTSGenerator', () => ({ getStreamingTTSGenerator: () => mock.generator }));
vi.mock('@/lib/tts/podcastAudioGenerator', () => ({
    getPodcastAudioConfig: () => ({ host1Voice: 'am_onyx', host2Voice: 'af_nova', speed: 1, pauseBetweenSegments: 300 }),
    savePodcastAudioConfig: vi.fn(),
}));
vi.mock('@/lib/tts/kokoroTTSProvider', () => ({ KOKORO_VOICES: { am_onyx: { gender: 'male', name: 'Alex' }, af_nova: { gender: 'female', name: 'Sarah' } } }));
vi.mock('@/lib/tts/audioValidator', () => ({ AudioValidator: { validateBlob: vi.fn() } }));
vi.mock('@/components/notebook/TTSProviderSettings', () => ({ default: () => null }));
vi.mock('@/components/notebook/TTSSettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/notebook/AudioPlayer', () => ({ default: ({ audioUrl }: { audioUrl: string }) => <audio data-testid="audio-player" src={audioUrl} /> }));
vi.mock('@/components/notebook/PodcastHistory', () => ({ PodcastHistory: ({ onPlay }: { onPlay: (url: string, title: string, podcastId: string) => void }) => mock.history.length > 0 ? <button type="button" onClick={() => onPlay('blob:restored-overview', 'Restored overview', 'restored-episode')}>Play saved fixture</button> : null }));
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); usePodcastGenerationStore.setState({ isGenerating: false, script: null, notebookId: null }); });
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
    it.each([
        [['excluded']],
        [['selected', 'excluded']],
    ])('saves attribution from actual script evidence (%j)', async (evidenceSourceIds) => {
        mock.script.mockResolvedValueOnce({ ...script(), metadata: { evidenceSourceIds } });
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast', ['selected', 'excluded']); });
        await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
        expect(usePodcastGenerationStore.getState().sourceIds).toEqual(evidenceSourceIds);
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
        const preparationSignal = mock.script.mock.calls[0][1].signal as AbortSignal;
        expect(preparationSignal.aborted).toBe(false);
        act(() => { command('Cancel my podcast', []); });
        await waitFor(() => expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('accepted'));
        expect(preparationSignal.aborted).toBe(true);
        await act(async () => { resolveScript(script()); });
        expect(mock.start).not.toHaveBeenCalled();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].operation).toBe('cancel');
    });
    it('treats an aborted preparation as cancellation without an error toast', async () => {
        mock.script.mockImplementationOnce((_content, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        }));
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast'); });
        await waitFor(() => expect(mock.script).toHaveBeenCalledTimes(1));
        act(() => { command('Cancel my podcast', []); });
        await waitFor(() => expect(mock.script.mock.calls[0][1].signal.aborted).toBe(true));
        await act(async () => {});
        expect(mock.start).not.toHaveBeenCalled();
        expect(mock.toast.mock.calls.some(([message]) => message.title === 'Generation Failed')).toBe(false);
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

describe('completed audio publication gate (mocked providers, real view and store)', () => {
    const passed: AudioValidationResult = { valid: true, hasSpeech: true, duration: 12, sampleRate: 24000, channels: 1, rms: 0.1, peak: 0.5, silenceRatio: 0.1, issues: [] };
    const complete = async () => {
        render(<PodcastView notebookId="notebook-a"/>);
        act(() => { command('Make a podcast'); });
        await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
        act(() => { mock.start.mock.calls[0][3]({ audioUrls: ['blob:segment'], segmentsReady: 2, totalDuration: 12 }); });
        await waitFor(() => expect(AudioValidator.validateBlob).toHaveBeenCalledTimes(1));
    };
    beforeEach(() => {
        Object.assign(mock.generator as object, { combineAudios: vi.fn().mockResolvedValue('blob:combined') });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array(2048)], { type: 'audio/wav' }) }));
        vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn(); });
        mock.save.mockResolvedValue({ id: 'saved-episode' });
        vi.mocked(AudioValidator.validateBlob).mockReset();
    });
    it('waits for the signal check before saving or offering final playback', async () => {
        let resolve!: (value: AudioValidationResult) => void;
        vi.mocked(AudioValidator.validateBlob).mockReturnValue(new Promise((done) => { resolve = done; }));
        await complete();
        expect(mock.save).not.toHaveBeenCalled();
        expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
        expect(usePodcastGenerationStore.getState().isGenerating).toBe(true);
        await act(async () => { resolve(passed); });
        await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
        expect(usePodcastGenerationStore.getState().audioUrl).toBe('blob:combined');
        expect(usePodcastGenerationStore.getState().podcastId).toBe('saved-episode');
    });
    it.each([
        ['silence', { ...passed, valid: false, hasSpeech: false, issues: ['Audio is silent'] }],
        ['corruption despite sufficient energy', { ...passed, valid: false, issues: ['Invalid audio header'] }],
    ])('rejects %s without saving or publishing', async (_name, result) => {
        vi.mocked(AudioValidator.validateBlob).mockResolvedValue(result);
        await complete();
        await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Audio check failed', description: expect.stringContaining('Retry from Studio') })));
        expect(mock.save).not.toHaveBeenCalled();
        expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
        expect(usePodcastGenerationStore.getState().partialAudioUrls).toEqual([]);
        expect(usePodcastGenerationStore.getState().isGenerating).toBe(false);
        expect(usePodcastGenerationStore.getState().progress?.phase).toBe('error');
    });
    it('rejects a validator exception without publishing unchecked audio', async () => {
        vi.mocked(AudioValidator.validateBlob).mockRejectedValue(new Error('Decoder unavailable'));
        await complete();
        await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Audio check failed' })));
        expect(mock.save).not.toHaveBeenCalled();
        expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
    });
    it('discards late validation after cancellation and a new run in the same notebook', async () => {
        let resolve!: (value: AudioValidationResult) => void;
        vi.mocked(AudioValidator.validateBlob).mockReturnValue(new Promise((done) => { resolve = done; }));
        await complete();
        act(() => {
            usePodcastGenerationStore.getState().cancelGeneration();
            usePodcastGenerationStore.getState().startGeneration('notebook-a', { ...script(), title: 'New run' });
        });
        await act(async () => { resolve(passed); });
        expect(mock.save).not.toHaveBeenCalled();
        expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
        expect(usePodcastGenerationStore.getState().script?.title).toBe('New run');
        expect(usePodcastGenerationStore.getState().isGenerating).toBe(true);
        expect(mock.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Audio check failed' }));
    });
});

describe('customizing another saved overview', () => {
    it('returns to the player when a saved episode is selected during customization', () => {
        usePodcastGenerationStore.setState({
            notebookId: 'notebook-a', audioUrl: 'blob:saved-overview',
            podcastId: 'saved-episode', script: script(), isGenerating: false,
        });
        const { rerender } = render(<PodcastView notebookId="notebook-a" />);
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        mock.history = [{ id: 'restored-episode' }];
        // Rerender so the history fixture becomes visible in the customization view.
        rerender(<PodcastView notebookId="notebook-a" />);
        fireEvent.click(screen.getByRole('button', { name: 'Play saved fixture' }));
        expect((screen.getByTestId('audio-player') as HTMLAudioElement).src).toContain('blob:restored-overview');
        expect(screen.queryByLabelText('Episode Focus')).toBeNull();
        mock.history = [];
    });
    it('lets the user cancel script preparation before speech starts', async () => {
        mock.script.mockImplementationOnce((_content, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        }));
        render(<PodcastView notebookId="notebook-a"/>);
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create audio overview' }));
        await waitFor(() => expect(mock.script).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel preparation' }));
        await waitFor(() => expect(mock.script.mock.calls[0][1].signal.aborted).toBe(true));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel preparation' })).toBeNull());
        expect(mock.start).not.toHaveBeenCalled();
        expect(mock.toast.mock.calls.some(([message]) => message.title === 'Generation Failed')).toBe(false);
    });
    afterEach(() => { mock.sources = mock.sources.filter((source) => source.id !== 'focused-ebook'); });
    const restoreSaved = () => {
        usePodcastGenerationStore.setState({
            notebookId: 'notebook-a', audioUrl: 'blob:saved-overview',
            podcastId: 'saved-episode', script: script(), isGenerating: false,
        });
        render(<PodcastView notebookId="notebook-a" />);
    };
    it('can edit focus and close customization without losing saved playback', async () => {
        restoreSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        fireEvent.change(screen.getByLabelText('Episode Focus'), { target: { value: "Transcriber's Notes" } });
        expect(usePodcastGenerationStore.getState().audioUrl).toBe('blob:saved-overview');
        expect(usePodcastGenerationStore.getState().podcastId).toBe('saved-episode');
        expect(mock.start).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Close audio customization' }));
        expect(screen.getByRole('heading', { name: 'Current audio overview' })).toBeTruthy();
        expect(usePodcastGenerationStore.getState().audioUrl).toBe('blob:saved-overview');
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        expect((screen.getByLabelText('Episode Focus') as HTMLInputElement).value).toBe("Transcriber's Notes");
        expect(mock.save).not.toHaveBeenCalled();
    });
    it('creates the next overview with its edited focus rather than immediately regenerating', async () => {
        restoreSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        fireEvent.change(screen.getByLabelText('Episode Focus'), { target: { value: "Transcriber's Notes" } });
        await userEvent.click(screen.getByRole('tab', { name: 'Deep Dive' }));
        expect((screen.getByLabelText('Episode Focus') as HTMLInputElement).value).toBe("Transcriber's Notes");
        fireEvent.click(screen.getByRole('button', { name: 'Create audio overview' }));
        await waitFor(() => expect(mock.script).toHaveBeenCalledTimes(1));
        expect(mock.script.mock.calls[0][1].userNotes).toContain("USER-SELECTED EPISODE FOCUS: Transcriber's Notes");
        expect(mock.script.mock.calls[0][1].type).toBe('deep-dive');
        await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
    });
    it.each(['pending', 'ready'])('respects the requested section when its ebook is %s', async (status) => {
        mock.sources.push({
            ...mock.sources[0], id: 'focused-ebook', title: 'The Republic', type: 'ebook', processing_status: status,
            content: '# Introduction\n\nUnrelated introduction.\n\n[SECTION: Transcriber’s Notes]\n\nNew original cover art is granted to the public domain.',
        });
        restoreSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Customize audio' }));
        fireEvent.change(screen.getByLabelText('Episode Focus'), { target: { value: 'Transcriber’s Notes' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create audio overview' }));
        if (status === 'pending') {
            await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Requested section is not ready' })));
            expect(mock.script).not.toHaveBeenCalled();
            expect(mock.start).not.toHaveBeenCalled();
            expect(usePodcastGenerationStore.getState().audioUrl).toBe('blob:saved-overview');
        } else {
            await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(1));
            expect(mock.script.mock.calls[0][0]).toContain('New original cover art');
            expect(mock.script.mock.calls[0][0]).not.toContain('Unrelated introduction');
            expect(mock.script.mock.calls[0][0]).not.toContain('SELECTED_SOURCE');
            expect(usePodcastGenerationStore.getState().sourceIds).toEqual(['focused-ebook']);
        }
    });
});
