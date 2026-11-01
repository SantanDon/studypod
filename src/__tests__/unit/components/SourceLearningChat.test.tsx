import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatArea from '@/components/notebook/ChatArea';
import { createSourceLearningQuestion, queueSourceLearningQuestion, SOURCE_LEARNING_QUESTION_EVENT } from '@/lib/sources/sourceLearningQuestion';
import { AUDIO_LISTENING_QUESTION_EVENT } from '@/lib/audio/listeningQuestion';
import { useAudiobookStore } from '@/stores/audiobookStore';

type TestSource = { id: string; title: string; type: string; content: string; processing_status: string };
type TestInputProps = { message: string; onMessageChange: (message: string) => void; onSend: () => void };
const state = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn(), retry: null as null | ((request: unknown) => void), sources: [] as TestSource[], busy: false }));
vi.mock('@/hooks/useChatMessages', () => ({ useChatMessages: (_notebookId: string, onRetry?: (request: unknown) => void) => { state.retry = onRetry ?? null; return { messages: [], sendMessageAsync: state.send, isSending: state.busy, deleteChatHistory: vi.fn(), isDeletingChatHistory: false }; } }));
vi.mock('@/hooks/useSources', () => ({ useSources: () => ({ sources: state.sources, isLoading: false, isFetching: false, error: null, retrySources: vi.fn() }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ isGuest: false, incrementUsage: vi.fn(), showAuthPrompt: vi.fn() }), useNotebookLimits: () => ({ canSendMessage: true, messagesRemaining: 10 }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/components/chat/ChatInput', () => ({ default: ({ message, onMessageChange, onSend }: TestInputProps) => <><textarea aria-label="Learning draft" value={message} onChange={e => onMessageChange(e.target.value)} /><button onClick={onSend}>Send draft</button></> }));
vi.mock('@/components/chat/SovereignChatIntro', () => ({ default: () => null }));
vi.mock('@/components/chat/MarkdownRenderer', () => ({ default: () => null }));
vi.mock('@/components/notebook/StudioAudioCommandCard', () => ({ default: () => null }));
vi.mock('@/components/notebook/CaptureButtons', () => ({ default: () => null }));
vi.mock('@/components/notebook/ChatEvidenceScope', () => ({ default: () => null }));
vi.mock('@/components/notebook/AddSourcesDialog', () => ({ default: () => null }));
vi.mock('@/lib/audio/studioAudioCommands', () => ({ parseStudioAudioIntent: () => null, useStudioAudioCommands: { getState: () => ({ draft: vi.fn() }) } }));

const readySource = { id: 'source-a', title: 'Cells', type: 'text', content: 'Cells use energy.', processing_status: 'completed' };
const makeRequest = (book: string) => createSourceLearningQuestion(book, { citation_id: 1, source_id: 'source-a', source_title: 'Cells', source_type: 'text', chunk_lines_from: 1, chunk_lines_to: 1 }, readySource.content, 'practice')!;
const view = (book: string, hasSource = true) => <ChatArea notebookId={book} hasSource={hasSource} notebook={{ id: book, title: 'Learning test' }} />;

beforeEach(() => {
  state.send.mockReset().mockResolvedValue({}); state.toast.mockReset(); state.retry = null; state.busy = false; state.sources = [readySource];
  useAudiobookStore.setState({ readingContextByNotebook: {} });
  localStorage.clear(); sessionStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('source learning chat delivery', () => {
  it('submits once, scopes evidence to the passage source, and ignores other notebooks', async () => {
    render(view('book-once'));
    const request = makeRequest('book-once');
    act(() => { queueSourceLearningQuestion(request); window.dispatchEvent(new CustomEvent(SOURCE_LEARNING_QUESTION_EVENT, { detail: request })); });
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0]).toMatchObject({ notebookId: 'book-once', sourceIds: ['source-a'] });
    expect(state.send.mock.calls[0][0].content).toContain('then wait for my answer');
    act(() => queueSourceLearningQuestion(makeRequest('other-book')));
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('consumes a queued mobile action after chat mounts', async () => {
    queueSourceLearningQuestion(makeRequest('book-mobile'));
    render(view('book-mobile'));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
  });
  it('keeps an unavailable-source question visible, and retries only against that source when restored', async () => {
    state.sources = [{ ...readySource, id: 'other-source' }];
    const { rerender } = render(view('book-unavailable'));
    act(() => queueSourceLearningQuestion(makeRequest('book-unavailable')));
    expect(state.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    state.sources = [readySource];
    rerender(view('book-unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0].sourceIds).toEqual(['source-a']);
  });
  it('keeps a question as a draft while another response is running', () => {
    state.busy = true;
    render(view('book-busy'));
    act(() => queueSourceLearningQuestion(makeRequest('book-busy')));
    expect(state.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
  });
  it('restores a failed request and retains its source on manual retry', async () => {
    state.send.mockRejectedValueOnce(new Error('Provider unavailable'));
    render(view('book-fail'));
    act(() => queueSourceLearningQuestion(makeRequest('book-fail')));
    await waitFor(() => expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0].sourceIds).toEqual(['source-a']);
  });
  it('restores only the learner question after an audio question fails and keeps context on retry', async () => {
    state.send.mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce({});
    render(view('book-audio-fail'));
    const question = 'Why is the cave important?';
    const request = {
      notebookId: 'book-audio-fail', sourceId: 'source-a', sourceTitle: 'The Republic',
      chapterId: 'chapter-1', chapterIndex: 0, chapterTitle: 'Book I',
      timeSeconds: 754, question,
    };

    act(() => window.dispatchEvent(new CustomEvent(AUDIO_LISTENING_QUESTION_EVENT, { detail: request })));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    const failedRequest = state.send.mock.calls[0][0];
    expect(failedRequest.content).toContain('[Audio listening context:');
    expect(failedRequest.content).toContain('[Reader position:');
    await waitFor(() => expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toBe(question));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0].content).toBe(failedRequest.content);
  });
  it('keeps ordinary follow-up questions scoped to the last audiobook chapter after leaving Studio', async () => {
    useAudiobookStore.getState().setReadingContext('book-followup', {
      audiobookId: 'render-1', sourceId: 'source-a', bookTitle: 'The Republic',
      chapterId: 'notes', chapterIndex: 1, chapterCount: 2,
      chapterTitle: 'Transcriber’s Notes', progressPercent: 42, isPlaying: false,
    });
    render(view('book-followup'));
    fireEvent.change(screen.getByLabelText('Learning draft'), {
      target: { value: 'What do these notes say?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));

    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0].sourceIds).toEqual(['source-a']);
    expect(state.send.mock.calls[0][0].content).toContain('Transcriber’s Notes');
  });
  it('clears the restored failure after a successful toast retry without erasing a newer draft', async () => {
    state.send.mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce({});
    render(view('book-toast-retry'));
    const input = screen.getByLabelText('Learning draft');
    fireEvent.change(input, { target: { value: 'Original question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('Original question'));
    expect(screen.getByText('Your draft was restored. Retry without retyping it.')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'A newer question' } });
    const failedRequest = state.send.mock.calls[0][0];
    expect(state.retry).toBeTypeOf('function');
    act(() => state.retry!(failedRequest));

    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Your draft was restored. Retry without retyping it.')).toBeNull());
    expect(state.send.mock.calls[1][0]).toEqual(failedRequest);
    expect((input as HTMLTextAreaElement).value).toBe('A newer question');
    expect(localStorage.getItem('studypod:chat-draft:book-toast-retry')).toBe('A newer question');
  });
  it('keeps a draft visible even if the notebook has lost all sources', () => {
    state.sources = [];
    render(view('book-empty', false));
    act(() => queueSourceLearningQuestion(makeRequest('book-empty')));
    expect((screen.getByRole('textbox', { name: 'Chat message' }) as HTMLInputElement).value).toContain('Cells use energy.');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('restores a blocked passage draft after remount and retries with its original source', async () => {
    state.busy = true;
    const first = render(view('book-remount'));
    act(() => queueSourceLearningQuestion(makeRequest('book-remount')));
    expect(JSON.parse(localStorage.getItem('studypod:chat-draft:book-remount')!)).toMatchObject({ sourceId: 'source-a', notebookId: 'book-remount' });
    first.unmount();
    state.busy = false;
    render(view('book-remount'));
    expect(state.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0].sourceIds).toEqual(['source-a']);
    await waitFor(() => expect(localStorage.getItem('studypod:chat-draft:book-remount')).toBeNull());
  });
  it('rechecks source availability on a failed draft restored after remount', async () => {
    state.send.mockRejectedValueOnce(new Error('Provider unavailable'));
    const first = render(view('book-retry-remount'));
    act(() => queueSourceLearningQuestion(makeRequest('book-retry-remount')));
    await waitFor(() => expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.'));
    first.unmount();
    state.sources = [{ ...readySource, id: 'other-source' }];
    const restored = render(view('book-retry-remount'));
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    expect(state.send).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    state.sources = [readySource];
    restored.rerender(view('book-retry-remount'));
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0].sourceIds).toEqual(['source-a']);
  });
  it('keeps saved passage scope isolated between notebooks', () => {
    state.busy = true;
    const first = render(view('book-isolated-a'));
    act(() => queueSourceLearningQuestion(makeRequest('book-isolated-a')));
    const saved = localStorage.getItem('studypod:chat-draft:book-isolated-a')!;
    first.unmount();
    // Even a misplaced envelope cannot hydrate another notebook's question or scope.
    localStorage.setItem('studypod:chat-draft:book-isolated-b', saved);
    const second = render(view('book-isolated-b'));
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toBe('');
    second.rerender(view('book-isolated-a'));
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('does not reuse restored passage scope after manual edits, even if text is changed back', async () => {
    state.busy = true;
    const first = render(view('book-edited'));
    act(() => queueSourceLearningQuestion(makeRequest('book-edited')));
    first.unmount();
    state.busy = false;
    render(view('book-edited'));
    const input = screen.getByLabelText('Learning draft');
    const original = (input as HTMLTextAreaElement).value;
    fireEvent.change(input, { target: { value: 'A different question' } });
    fireEvent.change(input, { target: { value: original } });
    expect(localStorage.getItem('studypod:chat-draft:book-edited')).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0].sourceIds).toBeUndefined();
  });
  it('recovers an in-flight passage question after reload without automatically resending it', async () => {
    state.send.mockImplementationOnce(() => new Promise(() => {}));
    const first = render(view('book-pending'));
    act(() => queueSourceLearningQuestion(makeRequest('book-pending')));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem('studypod:chat-draft:book-pending')!)).toMatchObject({ sourceId: 'source-a' });
    first.unmount();
    render(view('book-pending'));
    expect(state.send).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0].sourceIds).toEqual(['source-a']);
  });
  it('preserves a newer passage draft and its scope when the previous request fails', async () => {
    let rejectFirst!: (error: Error) => void;
    state.send.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    state.sources = [readySource, { ...readySource, id: 'source-b', title: 'Plants', content: 'Plants use light.' }];
    const first = render(view('book-overlap'));
    act(() => queueSourceLearningQuestion(makeRequest('book-overlap')));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    const newer = createSourceLearningQuestion('book-overlap', { citation_id: 2, source_id: 'source-b', source_title: 'Plants', source_type: 'text', chunk_lines_from: 1, chunk_lines_to: 1 }, 'Plants use light.', 'practice')!;
    act(() => queueSourceLearningQuestion(newer));
    await act(async () => { rejectFirst(new Error('Provider unavailable')); });
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Plants use light.');
    expect(JSON.parse(localStorage.getItem('studypod:chat-draft:book-overlap')!)).toMatchObject({ sourceId: 'source-b' });
    first.unmount();
    render(view('book-overlap'));
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0]).toMatchObject({ sourceIds: ['source-b'], content: expect.stringContaining('Plants use light.') });
  });
  it('preserves a newer scoped passage draft when an ordinary chat request fails', async () => {
    let rejectFirst!: (error: Error) => void;
    state.send.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    render(view('book-ordinary-overlap'));
    fireEvent.change(screen.getByLabelText('Learning draft'), { target: { value: 'My ordinary question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    act(() => queueSourceLearningQuestion(makeRequest('book-ordinary-overlap')));
    await act(async () => { rejectFirst(new Error('Provider unavailable')); });
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toContain('Cells use energy.');
    expect(JSON.parse(localStorage.getItem('studypod:chat-draft:book-ordinary-overlap')!)).toMatchObject({ sourceId: 'source-a' });
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][0].sourceIds).toEqual(['source-a']);
  });
  it('does not restore an old failed passage into a different notebook draft', async () => {
    let rejectFirst!: (error: Error) => void;
    state.send.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    localStorage.setItem('studypod:chat-draft:book-next', 'My next notebook question');
    const current = render(view('book-previous'));
    act(() => queueSourceLearningQuestion(makeRequest('book-previous')));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    current.rerender(view('book-next'));
    await act(async () => { rejectFirst(new Error('Provider unavailable')); });
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toBe('My next notebook question');
    expect(localStorage.getItem('studypod:chat-draft:book-next')).toBe('My next notebook question');
    expect(JSON.parse(localStorage.getItem('studypod:chat-draft:book-previous')!)).toMatchObject({ sourceId: 'source-a', notebookId: 'book-previous' });
  });
  it('continues to hydrate ordinary legacy text drafts without passage scope', async () => {
    localStorage.setItem('studypod:chat-draft:book-legacy', 'What are cells?');
    render(view('book-legacy'));
    expect((screen.getByLabelText('Learning draft') as HTMLTextAreaElement).value).toBe('What are cells?');
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0].sourceIds).toBeUndefined();
  });
});
