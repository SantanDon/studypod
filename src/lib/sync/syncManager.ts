/**
 * Sync Manager Service
 *
 * Orchestrates automatic syncing of data (encrypted or plaintext) to the cloud.
 * Handles queue processing, conflict resolution, and retry logic.
 *
 * Two modes:
 *   E2EE mode  — masterKey is present: data encrypted client-side before upload
 *   Plain mode — masterKey is null: data stored as stringified JSON (cloud user
 *                without local encryption, but still auth-gated server-side)
 */

import { useSyncStore } from '@/stores/syncStore';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { SyncQueue, type SyncExecutor } from './queue';
import { CloudClient } from './cloudClient';
import { encrypt } from '@/lib/encryption/encryption';
import { generateChecksum } from '@/lib/encryption/integrity';
import type { SyncOperation } from './types';
import type { EncryptedData } from '@/lib/encryption/types';

export interface ISyncManager {
  initialize(): void;
  shutdown(): void;
  queueSync(
    entityId: string,
    entityType: string,
    data: unknown,
    operationType?: 'create' | 'update' | 'delete'
  ): Promise<void>;
  processQueue(): Promise<void>;
  triggerSync(): Promise<void>;
  downloadData(entityId: string): Promise<unknown>;
  listSyncedItems(type?: string): Promise<unknown>;
  deleteData(entityId: string): Promise<void>;
}

class SyncManager implements ISyncManager {
  private queue: SyncQueue;
  private cloudClient: CloudClient;
  private isProcessing = false;
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.queue = new SyncQueue();

    const apiBase = import.meta.env.VITE_API_URL || '';
    const cleanApiBase = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    this.cloudClient = new CloudClient({
      baseUrl: cleanApiBase || window.location.origin,
    });

    // Wire up the executor so the queue can make real network calls
    this.queue.setExecutor(this.buildExecutor());
  }

  // ─── Executor ─────────────────────────────────────────────────────────────

  private buildExecutor(): SyncExecutor {
    return async (op: SyncOperation) => {
      const { userId } = useEncryptionStore.getState();
      if (!userId) {
        throw new Error('Cannot execute sync operation: no user context');
      }

      if (op.type === 'delete') {
        await this.cloudClient.delete(op.entityId);
        return;
      }

      // op.data is either an EncryptedData object (E2EE mode) or a
      // serialized plaintext JSON string (plain mode) — already prepared
      // by queueSync. Just need the checksum and serialized blob.
      const dataString =
        typeof op.data === 'string' ? op.data : JSON.stringify(op.data);
      const checksum = await generateChecksum(dataString);

      await this.cloudClient.upload({
        id: op.entityId,
        userId,
        type: op.entityType as 'notebook' | 'source' | 'note' | 'chat',
        encryptedData: dataString,
        salt: '',
        checksum,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      });
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  initialize() {
    // Process queue every 30 seconds
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 30000);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.processQueue();
      });
    }

    // Initial pass
    this.processQueue();
  }

  shutdown() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  // ─── Queue ────────────────────────────────────────────────────────────────

  /**
   * Queue data for cloud sync.
   *
   * Works in both E2EE mode (masterKey present — data encrypted) and
   * plaintext mode (masterKey null but userId set — data JSON-stringified).
   */
  async queueSync(
    entityId: string,
    entityType: string,
    data: unknown,
    operationType: 'create' | 'update' | 'delete' = 'update'
  ) {
    const { masterKey, userId } = useEncryptionStore.getState();

    if (!userId) {
      console.warn('Cannot queue sync: no user context available');
      return;
    }

    try {
      let payload: EncryptedData | string;

      if (masterKey) {
        // E2EE path — encrypt before queuing
        const dataString = JSON.stringify(data);
        payload = await encrypt(dataString, masterKey);
      } else {
        // Plaintext path — cloud user without local encryption
        payload = JSON.stringify(data);
      }

      await this.queue.add({
        type: operationType,
        entityType: entityType as 'notebook' | 'source' | 'note' | 'chat',
        entityId,
        data: payload,
        metadata: {
          userId,
          entityType,
          entityId,
          timestamp: Date.now(),
        },
      });

      const status = this.queue.getStatus();
      useSyncStore.getState().setPendingOperations(status.pending);

      if (navigator.onLine) {
        this.processQueue();
      }
    } catch (error) {
      console.error('Failed to queue sync:', error);
    }
  }

  /**
   * Drain the sync queue — works even without a masterKey for plain-mode users.
   */
  async processQueue() {
    if (this.isProcessing || !navigator.onLine) {
      return;
    }

    const { isSyncing } = useSyncStore.getState();
    if (isSyncing) return;

    const { userId } = useEncryptionStore.getState();
    if (!userId) {
      console.warn('Cannot process sync queue: no user context available');
      return;
    }

    this.isProcessing = true;
    useSyncStore.getState().setSyncing(true);

    try {
      await this.queue.process();

      const status = this.queue.getStatus();
      useSyncStore.getState().setPendingOperations(status.pending);
      useSyncStore.getState().setFailedOperations(status.failed);
      useSyncStore.getState().setLastSyncTime(Date.now());
      useSyncStore.getState().setError(null);
    } catch (error) {
      console.error('Queue processing error:', error);
      useSyncStore
        .getState()
        .setError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      this.isProcessing = false;
      useSyncStore.getState().setSyncing(false);
    }
  }

  async triggerSync() {
    await this.processQueue();
  }

  // ─── Cloud operations ─────────────────────────────────────────────────────

  async downloadData(entityId: string): Promise<unknown> {
    const { masterKey } = useEncryptionStore.getState();

    const remoteData = await this.cloudClient.download(entityId);
    if (!remoteData) return null;

    const { verifyChecksum } = await import('@/lib/encryption/integrity');
    const isValid = await verifyChecksum(remoteData.encryptedData, remoteData.checksum);
    if (!isValid) {
      throw new Error('Data integrity check failed');
    }

    if (masterKey) {
      // E2EE mode — decrypt
      const { decrypt } = await import('@/lib/encryption/encryption');
      const encryptedData: EncryptedData = JSON.parse(remoteData.encryptedData);
      const decrypted = await decrypt(encryptedData, masterKey);
      return JSON.parse(decrypted);
    }

    // Plaintext mode — data already JSON
    try {
      return JSON.parse(remoteData.encryptedData);
    } catch {
      return remoteData.encryptedData;
    }
  }

  async listSyncedItems(type?: string): Promise<unknown> {
    return this.cloudClient.list(type);
  }

  async deleteData(entityId: string): Promise<void> {
    await this.cloudClient.delete(entityId);
    this.queue.remove(entityId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let syncManagerInstance: ISyncManager | null = null;

export function getSyncManager(): ISyncManager {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager();
  }
  return syncManagerInstance;
}

export function initializeSyncManager() {
  const manager = getSyncManager();
  manager.initialize();
  return manager;
}

export function shutdownSyncManager() {
  if (syncManagerInstance) {
    syncManagerInstance.shutdown();
    syncManagerInstance = null;
  }
}
