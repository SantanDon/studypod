import { describe, expect, it } from 'vitest';
import { selectNarrationChapterIds } from '../services/audiobookSelectionService.js';
const manifest = { chapters: [
        { id: 'one', text: 'First chapter.' },
        { id: 'divider', text: '', narratable: false },
        { id: 'two', text: 'Second chapter.' },
        { id: 'three', narrationText: 'Third chapter.' },
    ] };
describe('audiobook narration selection', () => {
    it('selects all narratable sections when the request omits the selection', () => {
        expect(selectNarrationChapterIds(manifest)).toEqual(['one', 'two', 'three']);
        expect(selectNarrationChapterIds(manifest, [])).toEqual(['one', 'two', 'three']);
    });
    it('normalizes repeats and out-of-order selection to document order', () => expect(selectNarrationChapterIds(manifest, ['three', 'one', 'three'])).toEqual(['one', 'three']));
    it('rejects a foreign chapter rather than silently dropping it', () => expect(() => selectNarrationChapterIds(manifest, ['one', 'foreign'])).toThrow('not in this book'));
    it('rejects a structural divider', () => expect(() => selectNarrationChapterIds(manifest, ['divider'])).toThrow('structural divider'));
    it.each(['one', 1, {}, true])('rejects a non-array selection %s', (input) => expect(() => selectNarrationChapterIds(manifest, input)).toThrow('array'));
    it.each([['one', {}], ['one', ''], ['one', 1]])('rejects malformed entries without shrinking the requested coverage: %s', (...input) => expect(() => selectNarrationChapterIds(manifest, input)).toThrow('nonempty strings'));
    it('rejects empty selected chapters instead of reporting a shortened book as complete', () => expect(() => selectNarrationChapterIds({ chapters: [{ id: 'empty', text: ' ' }] }, ['empty'])).toThrow('no extractable'));
    it('rejects an empty document', () => expect(() => selectNarrationChapterIds({ chapters: [] })).toThrow('required'));
    it('bounds request size', () => expect(() => selectNarrationChapterIds(manifest, Array(501).fill('one'))).toThrow('500'));
});
