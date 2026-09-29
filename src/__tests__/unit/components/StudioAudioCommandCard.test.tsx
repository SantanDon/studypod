import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioAudioCommandCard from '@/components/notebook/StudioAudioCommandCard';
import { parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import type { Source } from '@/types/domain/Source';
vi.mock('@/lib/tts/streamingTTSGenerator', () => ({ getStreamingTTSGenerator: () => ({ cancel: vi.fn(), isRunning: () => false }) }));
const source = (id: string, prepared = false): Source => ({
    id, notebook_id: 'notebook-a', title: `Source ${id}`, type: 'pdf',
    processing_status: 'ready', content: 'Permitted test content. '.repeat(10),
    created_at: '2026-09-29T12:00:00Z', updated_at: '2026-09-29T12:00:00Z',
    metadata: prepared ? { fileName: `${id}.pdf`, chapters: [{ id: 'one' }] } : {},
});
function draft(message = 'Make a podcast from this document', id?: string) {
    useStudioAudioCommands.getState().draft('notebook-a', parseStudioAudioIntent(message)!, id);
}
beforeEach(() => useStudioAudioCommands.setState({ requests: {} }));
afterEach(cleanup);
describe('chat audio confirmation UI', () => {
    it('does not queue work before explicit confirmation', () => {
        draft();
        render(<StudioAudioCommandCard notebookId="notebook-a" sources={[source('one')]}/>);
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('draft');
        fireEvent.click(screen.getByRole('button', { name: 'Confirm generation' }));
        expect(useStudioAudioCommands.getState().requests['notebook-a']).toMatchObject({ phase: 'queued', sourceIds: ['one'] });
    });
    it('does not silently choose all notebook sources when the request is ambiguous', () => {
        draft();
        render(<StudioAudioCommandCard notebookId="notebook-a" sources={[source('one'), source('two')]}/>);
        expect(screen.getByRole('button', { name: 'Confirm generation' })).toBeDisabled();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm generation' }));
        expect(useStudioAudioCommands.getState().requests['notebook-a'].sourceIds).toEqual(['two']);
    });
    it('requires a book manifest and offers import rather than using a chat summary', () => {
        draft('Read this whole PDF aloud');
        render(<StudioAudioCommandCard notebookId="notebook-a" sources={[source('one')]}/>);
        expect(screen.getByRole('button', { name: 'Confirm generation' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Open audio import' })).toBeInTheDocument();
    });
    it('accepts prepared PDF manifests, not just sources labelled ebook', () => {
        draft('Read this whole PDF aloud');
        render(<StudioAudioCommandCard notebookId="notebook-a" sources={[source('one', true)]}/>);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm generation' }));
        expect(useStudioAudioCommands.getState().requests['notebook-a']).toMatchObject({ kind: 'audiobook', sourceIds: ['one'], phase: 'queued' });
    });
    it('does not show another notebook command', () => {
        draft();
        render(<StudioAudioCommandCard notebookId="notebook-b" sources={[source('one')]}/>);
        expect(screen.queryByRole('region', { name: 'Chat audio action' })).not.toBeInTheDocument();
    });
    it('invalidates a source selection if the source disappears before confirmation', () => {
        draft('Make a podcast', 'one');
        const view = render(<StudioAudioCommandCard notebookId="notebook-a" sources={[source('one')]}/>);
        view.rerender(<StudioAudioCommandCard notebookId="notebook-a" sources={[]}/>);
        expect(screen.getByRole('button', { name: 'Confirm generation' })).toBeDisabled();
        expect(useStudioAudioCommands.getState().requests['notebook-a'].phase).toBe('draft');
    });
    it('lets a cancellation supersede preparation and ignores the superseded acknowledgment', () => {
        draft();
        const store = useStudioAudioCommands.getState();
        const id = store.requests['notebook-a'].id;
        store.queue('notebook-a', id, ['one']);
        store.claim('notebook-a', 'podcast');
        act(() => { expect(store.draft('notebook-a', parseStudioAudioIntent('Cancel my podcast')!)).toBe(true); });
        store.finish('notebook-a', id, true, 'Old success');
        expect(useStudioAudioCommands.getState().requests['notebook-a']).toMatchObject({ operation: 'cancel', phase: 'draft' });
    });
});
