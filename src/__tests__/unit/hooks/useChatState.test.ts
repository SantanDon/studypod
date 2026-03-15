import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatState } from '@/components/chat/hooks/useChatState';

describe('useChatState Hook', () => {
  it('initializes with default values', () => {
    const { result } = renderHook(() => useChatState());

    expect(result.current.message).toBe('');
    expect(result.current.pendingUserMessage).toBeNull();
    expect(result.current.showAiLoading).toBe(false);
    expect(result.current.focusedSourceId).toBeNull();
    expect(result.current.isFocusModeActive).toBe(false);
    expect(result.current.clickedQuestions.size).toBe(0);
    expect(result.current.lastMessageCount).toBe(0);
    expect(result.current.selectedTutorId).toBe('default');
  });

  it('initializes with focused source ID', () => {
    const { result } = renderHook(() => useChatState('source-123'));

    expect(result.current.focusedSourceId).toBe('source-123');
    expect(result.current.isFocusModeActive).toBe(true);
  });

  it('updates message state', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessage('Hello world');
    });

    expect(result.current.message).toBe('Hello world');
  });

  it('updates pending user message', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setPendingUserMessage('Pending message');
    });

    expect(result.current.pendingUserMessage).toBe('Pending message');
  });

  it('updates AI loading state', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setShowAiLoading(true);
    });

    expect(result.current.showAiLoading).toBe(true);

    act(() => {
      result.current.setShowAiLoading(false);
    });

    expect(result.current.showAiLoading).toBe(false);
  });

  it('updates focused source ID', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setFocusedSourceId('source-456');
    });

    expect(result.current.focusedSourceId).toBe('source-456');
  });

  it('updates focus mode active state', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setIsFocusModeActive(true);
    });

    expect(result.current.isFocusModeActive).toBe(true);
  });

  it('manages clicked questions set', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      const newSet = new Set<string>(['question-1', 'question-2']);
      result.current.setClickedQuestions(newSet);
    });

    expect(result.current.clickedQuestions.size).toBe(2);
    expect(result.current.clickedQuestions.has('question-1')).toBe(true);
    expect(result.current.clickedQuestions.has('question-2')).toBe(true);
  });

  it('updates last message count', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setLastMessageCount(5);
    });

    expect(result.current.lastMessageCount).toBe(5);
  });

  it('updates selected tutor ID', () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setSelectedTutorId('tutor-123');
    });

    expect(result.current.selectedTutorId).toBe('tutor-123');
  });

  it('updates focus mode when initial focused source changes', () => {
    const { result, rerender } = renderHook(
      ({ sourceId }: { sourceId?: string }) => useChatState(sourceId),
      { initialProps: { sourceId: undefined } }
    );

    expect(result.current.isFocusModeActive).toBe(false);

    rerender({ sourceId: 'source-789' });

    expect(result.current.focusedSourceId).toBe('source-789');
    expect(result.current.isFocusModeActive).toBe(true);
  });

  it('clears focus mode when initial focused source is removed', () => {
    const { result, rerender } = renderHook(
      ({ sourceId }: { sourceId?: string }) => useChatState(sourceId),
      { initialProps: { sourceId: 'source-123' } }
    );

    expect(result.current.isFocusModeActive).toBe(true);

    rerender({ sourceId: undefined });

    expect(result.current.focusedSourceId).toBeNull();
    expect(result.current.isFocusModeActive).toBe(false);
  });

  it('maintains independent state for multiple hook instances', () => {
    const { result: result1 } = renderHook(() => useChatState());
    const { result: result2 } = renderHook(() => useChatState());

    act(() => {
      result1.current.setMessage('Message 1');
      result2.current.setMessage('Message 2');
    });

    expect(result1.current.message).toBe('Message 1');
    expect(result2.current.message).toBe('Message 2');
  });
});
