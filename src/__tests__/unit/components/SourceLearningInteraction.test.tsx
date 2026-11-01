import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceContentViewer from '@/components/chat/SourceContentViewer';
import { buildSourceLearningQuestionMessage, claimSourceLearningQuestion, consumeQueuedSourceLearningQuestion, createSourceLearningQuestion, MAX_LEARNING_PASSAGE_LENGTH, queueSourceLearningQuestion, SOURCE_LEARNING_QUESTION_EVENT } from '@/lib/sources/sourceLearningQuestion';
import type { Citation } from '@/types/message';

const citation: Citation = { citation_id: 1, source_id: 'source-a', source_title: 'Cell biology', source_type: 'text', chunk_lines_from: 2, chunk_lines_to: 3, excerpt: 'Untrusted model-generated excerpt' };
const content = 'Outside the selection\nMitochondria release usable energy.\nCells use that energy for work.\nAlso outside';

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('source learning passage and delivery', () => {
  it('extracts the actual cited lines rather than trusting a generated excerpt', () => {
    const request = createSourceLearningQuestion('book-extract', citation, content, 'explain')!;
    expect(request.passage).toBe('Mitochondria release usable energy.\nCells use that energy for work.');
    expect(request.sourceId).toBe('source-a');
    expect(buildSourceLearningQuestionMessage(request)).not.toContain(citation.excerpt);
  });
  it.each([{ chunk_lines_from: 0 }, { chunk_lines_to: 99 }, { chunk_lines_from: 3, chunk_lines_to: 2 }, { chunk_lines_from: undefined }, { citation_id: -1 }])('rejects unsupported citation selections %o', (overrides) => {
    expect(createSourceLearningQuestion('book-invalid', { ...citation, ...overrides }, content, 'explain')).toBeNull();
  });
  it('bounds long source excerpts and states that they were shortened', () => {
    const request = createSourceLearningQuestion('book-long', { ...citation, chunk_lines_from: 1, chunk_lines_to: 1 }, 'a'.repeat(5000), 'practice')!;
    expect(request.passage).toHaveLength(MAX_LEARNING_PASSAGE_LENGTH);
    expect(request.shortened).toBe(true);
    const message = buildSourceLearningQuestionMessage(request);
    expect(message).toContain('Ask exactly one source-grounded question, then wait for my answer');
    expect(message).toContain('Do not give the answer');
    expect(message).toContain('(excerpt shortened)');
  });
  it('keeps a mobile handoff scoped to its notebook and claims it once across queue and events', () => {
    const request = createSourceLearningQuestion('book-queue', citation, content, 'practice')!;
    queueSourceLearningQuestion(request);
    expect(consumeQueuedSourceLearningQuestion('different-book')).toBeNull();
    expect(claimSourceLearningQuestion(request, 'different-book')).toBe(false);
    expect(consumeQueuedSourceLearningQuestion('book-queue')).toEqual(request);
    expect(claimSourceLearningQuestion(request, 'book-queue')).toBe(true);
    expect(claimSourceLearningQuestion(request, 'book-queue')).toBe(false);
    expect(consumeQueuedSourceLearningQuestion('book-queue')).toBeNull();
  });
  it('works with session storage blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const request = createSourceLearningQuestion('book-storage', citation, content, 'explain')!;
    expect(() => queueSourceLearningQuestion(request)).not.toThrow();
    expect(consumeQueuedSourceLearningQuestion('book-storage')).toEqual(request);
  });
  it('offers passage actions only for a real citation and sends the selected source passage', () => {
    const listener = vi.fn();
    window.addEventListener(SOURCE_LEARNING_QUESTION_EVENT, listener);
    const { rerender } = render(<SourceContentViewer notebookId="book-viewer" citation={citation} sourceContent={content} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test my understanding' }));
    expect(listener).toHaveBeenCalledTimes(1);
    const request = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(request).toMatchObject({ action: 'practice', sourceId: 'source-a', passage: 'Mitochondria release usable energy.\nCells use that energy for work.' });
    rerender(<SourceContentViewer notebookId="book-viewer" citation={citation} sourceContent={content} isOpenedFromSourceList />);
    expect(screen.queryByRole('button', { name: 'Explain this passage' })).not.toBeInTheDocument();
    window.removeEventListener(SOURCE_LEARNING_QUESTION_EVENT, listener);
  });
});
