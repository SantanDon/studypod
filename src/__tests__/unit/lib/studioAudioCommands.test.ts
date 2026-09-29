import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasNarrationManifest, parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
beforeEach(() => useStudioAudioCommands.setState({ requests: {} }));
afterEach(() => vi.useRealTimers());
const draft = (notebookId = 'notebook-a', text = 'Make a podcast from this document') => {
    const intent = parseStudioAudioIntent(text)!;
    expect(useStudioAudioCommands.getState().draft(notebookId, intent, 'source-a')).toBe(true);
    return useStudioAudioCommands.getState().requests[notebookId];
};
describe('explicit chat audio intent', () => {
    it.each([
        ['Make a podcast from this document', 'podcast', 'generate'],
        ['Can you make a podcast about the argument in chapter five?', 'podcast', 'generate'],
        ['Please read this whole PDF aloud', 'audiobook', 'generate'],
        ['Narrate the entire document', 'audiobook', 'generate'],
        ['Resume my audiobook', 'audiobook', 'resume'],
        ['Check my podcast status', 'podcast', 'status'],
        ['Cancel the podcast', 'podcast', 'cancel'],
        ['Download my audiobook', 'audiobook', 'open'],
        ['Read chapter 5 aloud', 'audiobook', 'open'],
    ])('recognizes %s without executing it', (text, kind, operation) => expect(parseStudioAudioIntent(text)).toMatchObject({ kind, operation }));
    it.each(['What is a podcast?', 'How do I create an audiobook?', 'Do not make a podcast.', 'Never read this aloud', 'Explain the words "make a podcast"', 'Make a podcast and an audiobook', 'Make an outline of this essay', 'x'.repeat(1001)])('does not execute a mention, negation or ambiguous request: %s', (text) => expect(parseStudioAudioIntent(text)).toBeNull());
    it('extracts a podcast focus without rewriting source content', () => expect(parseStudioAudioIntent('Make a podcast focusing on Plato and justice')?.focus).toBe('Plato and justice'));
    it('requires an actual book manifest rather than treating any source text as full narration', () => {
        expect(hasNarrationManifest({ metadata: { fileName: 'book.pdf', chapters: [{ id: 'one' }] } })).toBe(true);
        expect(hasNarrationManifest({ metadata: { charCount: 500 } })).toBe(false);
        expect(hasNarrationManifest({ metadata: '{bad' })).toBe(false);
    });
});
describe('scoped Studio audio command lifecycle', () => {
    it('requires confirmation, and claims a request exactly once even after remount', () => {
        const request = draft();
        const store = useStudioAudioCommands.getState();
        expect(store.claim('notebook-a', 'podcast')).toBeNull();
        expect(store.queue('notebook-a', request.id, ['source-a'])).toBe(true);
        expect(store.claim('notebook-a', 'podcast')?.id).toBe(request.id);
        expect(store.claim('notebook-a', 'podcast')).toBeNull();
    });
    it('does not consume another notebook or the wrong Studio tool', () => {
        const request = draft();
        const store = useStudioAudioCommands.getState();
        store.queue('notebook-a', request.id, ['source-a']);
        expect(store.claim('notebook-b', 'podcast')).toBeNull();
        expect(store.claim('notebook-a', 'audiobook')).toBeNull();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('queued');
    });
    it('requires a nonempty confirmed source selection for generation', () => {
        const request = draft();
        expect(useStudioAudioCommands.getState().queue('notebook-a', request.id, [])).toBe(false);
    });
    it('does not overwrite an executing request or accept stale acknowledgments', () => {
        const request = draft();
        const store = useStudioAudioCommands.getState();
        store.queue('notebook-a', request.id, ['source-a']);
        store.claim('notebook-a', 'podcast');
        expect(store.draft('notebook-a', parseStudioAudioIntent('Make another podcast')!)).toBe(false);
        store.finish('notebook-a', 'wrong-id', true, 'not real');
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('executing');
        store.finish('notebook-a', request.id, false, 'Source unavailable');
        expect(useStudioAudioCommands.getState().requests['notebook-a']).toMatchObject({ phase: 'failed', result: 'Source unavailable' });
    });
    it('expires a delayed command rather than starting generation when a notebook is revisited', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
        const request = draft();
        const store = useStudioAudioCommands.getState();
        store.queue('notebook-a', request.id, ['source-a']);
        vi.advanceTimersByTime(60001);
        expect(store.claim('notebook-a', 'podcast')).toBeNull();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('failed');
    });
    it('allows a queued command to be dismissed before any effect consumes it', () => {
        const request = draft();
        const store = useStudioAudioCommands.getState();
        store.queue('notebook-a', request.id, ['source-a']);
        store.dismiss('notebook-a', request.id);
        expect(store.claim('notebook-a', 'podcast')).toBeNull();
    });
});
