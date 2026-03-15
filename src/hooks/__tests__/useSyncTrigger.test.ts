/**
 * Tests for useSyncTrigger hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSyncTrigger } from '../useSyncTrigger';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { getSyncManager, type ISyncManager } from '@/lib/sync/syncManager';

// Mock the dependencies
vi.mock('@/stores/encryptionStore');
vi.mock('@/lib/sync/syncManager');

describe('useSyncTrigger', () => {
  const mockQueueSync = vi.fn();
  const mockGetSyncManager = vi.mocked(getSyncManager);
  const mockUseEncryptionStore = vi.mocked(useEncryptionStore);

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup default mock implementations
    mockGetSyncManager.mockReturnValue({
      queueSync: mockQueueSync,
    } as unknown as ISyncManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger sync when user is authenticated', async () => {
    // Mock authenticated state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: true,
      userId: 'test-user-123',
    } as unknown as ReturnType<typeof useEncryptionStore>);

    const { result } = renderHook(() => useSyncTrigger());

    const testData = { title: 'Test Notebook', content: 'Test content' };
    
    await act(async () => {
      await result.current.triggerSync('notebook', 'notebook-1', testData);
    });

    expect(mockQueueSync).toHaveBeenCalledWith('notebook-1', 'notebook', testData);
    expect(mockQueueSync).toHaveBeenCalledTimes(1);
  });

  it('should not trigger sync when user is not unlocked', async () => {
    // Mock locked state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: false,
      userId: 'test-user-123',
    } as unknown as ReturnType<typeof useEncryptionStore>);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSyncTrigger());

    const testData = { title: 'Test Notebook' };
    
    await act(async () => {
      await result.current.triggerSync('notebook', 'notebook-1', testData);
    });

    expect(mockQueueSync).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Cannot sync: user not authenticated');

    consoleSpy.mockRestore();
  });

  it('should not trigger sync when userId is null', async () => {
    // Mock state with no userId
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: true,
      userId: null,
    } as unknown as ReturnType<typeof useEncryptionStore>);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSyncTrigger());

    const testData = { title: 'Test Notebook' };
    
    await act(async () => {
      await result.current.triggerSync('notebook', 'notebook-1', testData);
    });

    expect(mockQueueSync).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Cannot sync: user not authenticated');

    consoleSpy.mockRestore();
  });

  it('should handle sync errors gracefully', async () => {
    // Mock authenticated state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: true,
      userId: 'test-user-123',
    } as unknown as ReturnType<typeof useEncryptionStore>);

    // Mock queueSync to throw error
    const testError = new Error('Sync failed');
    mockQueueSync.mockRejectedValue(testError);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSyncTrigger());

    const testData = { title: 'Test Notebook' };
    
    await expect(async () => {
      await act(async () => {
        await result.current.triggerSync('notebook', 'notebook-1', testData);
      });
    }).rejects.toThrow('Sync failed');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to trigger sync:', testError);

    consoleErrorSpy.mockRestore();
  });

  it('should work with different entity types', async () => {
    // Mock authenticated state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: true,
      userId: 'test-user-123',
    } as unknown as ReturnType<typeof useEncryptionStore>);

    const { result } = renderHook(() => useSyncTrigger());

    // Test with source entity
    const sourceData = { url: 'https://example.com', title: 'Test Source' };
    await act(async () => {
      await result.current.triggerSync('source', 'source-1', sourceData);
    });

    expect(mockQueueSync).toHaveBeenCalledWith('source-1', 'source', sourceData);

    // Test with flashcard entity
    const flashcardData = { question: 'Q?', answer: 'A' };
    await act(async () => {
      await result.current.triggerSync('flashcard', 'flashcard-1', flashcardData);
    });

    expect(mockQueueSync).toHaveBeenCalledWith('flashcard-1', 'flashcard', flashcardData);
    expect(mockQueueSync).toHaveBeenCalledTimes(2);
  });

  it('should memoize triggerSync function based on auth state', () => {
    // Mock authenticated state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: true,
      userId: 'test-user-123',
    } as unknown as ReturnType<typeof useEncryptionStore>);

    const { result, rerender } = renderHook(() => useSyncTrigger());
    const firstTriggerSync = result.current.triggerSync;

    // Rerender without changing auth state
    rerender();
    expect(result.current.triggerSync).toBe(firstTriggerSync);

    // Change auth state
    mockUseEncryptionStore.mockReturnValue({
      isUnlocked: false,
      userId: null,
    } as unknown as ReturnType<typeof useEncryptionStore>);

    rerender();
    expect(result.current.triggerSync).not.toBe(firstTriggerSync);
  });
});
