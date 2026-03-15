/**
 * Sync state store using Zustand
 * 
 * Manages sync state globally with persistence.
 * Follows existing pattern from podcastGenerationStore.ts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConflictInfo } from '@/lib/sync/types';

interface SyncState {
  // Connection state
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  
  // Queue state
  pendingOperations: number;
  failedOperations: number;
  
  // Conflicts
  conflicts: ConflictInfo[];
  
  // Errors
  error: string | null;
  
  // Actions
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  setPendingOperations: (count: number) => void;
  setFailedOperations: (count: number) => void;
  addConflict: (conflict: ConflictInfo) => void;
  resolveConflict: (entityId: string) => void;
  clearConflicts: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      // Initial state
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: false,
      lastSyncTime: null,
      pendingOperations: 0,
      failedOperations: 0,
      conflicts: [],
      error: null,

      // Actions
      setOnline: (online) => set({ isOnline: online }),
      
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      
      setPendingOperations: (count) => set({ pendingOperations: count }),
      
      setFailedOperations: (count) => set({ failedOperations: count }),
      
      addConflict: (conflict) => set((state) => ({
        conflicts: [...state.conflicts, conflict]
      })),
      
      resolveConflict: (entityId) => set((state) => ({
        conflicts: state.conflicts.filter(c => c.entityId !== entityId)
      })),
      
      clearConflicts: () => set({ conflicts: [] }),
      
      setError: (error) => set({ error }),
      
      reset: () => set({
        isSyncing: false,
        lastSyncTime: null,
        pendingOperations: 0,
        failedOperations: 0,
        conflicts: [],
        error: null,
      }),
    }),
    {
      name: 'sync-store',
      partialze: (state) => ({
        lastSyncTime: state.lastSyncTime,
        conflicts: state.conflicts,
      }),
    }
  )
);

/**
 * Individual selectors for efficient rendering
 */
export function useIsOnline(): boolean {
  return useSyncStore((state) => state.isOnline);
}

export function useIsSyncing(): boolean {
  return useSyncStore((state) => state.isSyncing);
}

export function useLastSyncTime(): number | null {
  return useSyncStore((state) => state.lastSyncTime);
}

export function usePendingOperations(): number {
  return useSyncStore((state) => state.pendingOperations);
}

export function useConflicts(): ConflictInfo[] {
  return useSyncStore((state) => state.conflicts);
}

export function useSyncError(): string | null {
  return useSyncStore((state) => state.error);
}
