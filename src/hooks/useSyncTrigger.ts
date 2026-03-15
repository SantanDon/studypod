/**
 * useSyncTrigger Hook
 * 
 * Provides a convenient way for components to trigger sync operations
 * when data is mutated. Ensures sync operations include the current
 * user's context and only work when the user is authenticated.
 */

import { useCallback } from 'react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { getSyncManager } from '@/lib/sync/syncManager';

/**
 * Hook to trigger sync operations for data mutations
 * 
 * @returns Object with triggerSync function
 */
export function useSyncTrigger() {
  const { isUnlocked, userId } = useEncryptionStore();

  const triggerSync = useCallback(
    async (
      entityType: string,
      entityId: string,
      data: unknown,
      operationType: 'create' | 'update' | 'delete' = 'update'
    ) => {
      // Check if user is authenticated
      if (!isUnlocked || !userId) {
        console.warn('Cannot sync: user not authenticated');
        return;
      }

      try {
        const syncManager = getSyncManager();
        await syncManager.queueSync(entityId, entityType, data, operationType);
      } catch (error) {
        console.error('Failed to trigger sync:', error);
        throw error;
      }
    },
    [isUnlocked, userId]
  );

  return { triggerSync };
}
