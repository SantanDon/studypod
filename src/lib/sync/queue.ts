/**
 * Sync queue management
 *
 * Manages pending sync operations with retry logic and persistence.
 * Operations are stored in localStorage and processed when online.
 *
 * The actual network calls are delegated to an executor function that
 * the SyncManager injects after construction — keeping this class
 * decoupled from the CloudClient.
 */

import { SyncOperation, SyncQueueStatus } from './types';
import { useEncryptionStore } from '@/stores/encryptionStore';

const STORAGE_KEY = 'sync_queue';
const MAX_RETRIES = 3;

export type SyncExecutor = (op: SyncOperation) => Promise<void>;

/**
 * Sync Queue Manager
 * Handles queuing, processing, and retry logic for sync operations
 */
export class SyncQueue {
  private queue: SyncOperation[] = [];
  private processing = false;
  private executor: SyncExecutor | null = null;

  constructor() {
    this.load();
  }

  /**
   * Inject the executor function that performs the actual network call.
   * Must be called by SyncManager before any operations are processed.
   */
  setExecutor(fn: SyncExecutor): void {
    this.executor = fn;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load sync queue:', error);
      this.queue = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save sync queue:', error);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Add operation to queue
   */
  async add(operation: Omit<SyncOperation, 'id' | 'timestamp' | 'retries' | 'status'>): Promise<void> {
    const op: SyncOperation = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      retries: 0,
      status: 'pending',
    };

    this.queue.push(op);
    this.save();

    // Auto-process immediately if executor available and not already running
    if (!this.processing && this.executor) {
      await this.process();
    }
  }

  /**
   * Process all pending operations sequentially with retry logic
   */
  async process(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      const { userId } = useEncryptionStore.getState();
      const pending = this.queue.filter(
        op => op.status === 'pending' && (!op.metadata?.userId || op.metadata.userId === userId)
      );

      for (const op of pending) {
        try {
          op.status = 'processing';
          this.save();

          await this.executeOperation(op);

          op.status = 'completed';
          this.save();
        } catch (error) {
          console.error(`Sync operation ${op.id} failed:`, error);

          op.retries++;

          if (op.retries >= MAX_RETRIES) {
            op.status = 'failed';
          } else {
            op.status = 'pending';
            // Exponential backoff
            await this.delay(Math.pow(2, op.retries) * 1000);
          }

          this.save();
        }
      }

      // Clean up completed operations
      this.queue = this.queue.filter(op => op.status !== 'completed');
      this.save();
    } finally {
      this.processing = false;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async executeOperation(op: SyncOperation): Promise<void> {
    if (!this.executor) {
      // No executor injected yet — skip silently so queued items stay pending
      console.warn('SyncQueue: executor not set, deferring operation', op.id);
      return;
    }

    await this.executor(op);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Status & Helpers ─────────────────────────────────────────────────────

  getStatus(): SyncQueueStatus {
    const { userId } = useEncryptionStore.getState();
    const pending = this.queue.filter(
      op => op.status === 'pending' && (!op.metadata?.userId || op.metadata.userId === userId)
    ).length;
    const failed = this.queue.filter(
      op => op.status === 'failed' && (!op.metadata?.userId || op.metadata.userId === userId)
    ).length;
    const lastSync =
      this.queue.length > 0 ? Math.max(...this.queue.map(op => op.timestamp)) : null;

    return { pending, failed, lastSync };
  }

  getAll(): SyncOperation[] {
    return [...this.queue];
  }

  getPending(): SyncOperation[] {
    const { userId } = useEncryptionStore.getState();
    return this.queue.filter(
      op => op.status === 'pending' && (!op.metadata?.userId || op.metadata.userId === userId)
    );
  }

  getFailed(): SyncOperation[] {
    const { userId } = useEncryptionStore.getState();
    return this.queue.filter(
      op => op.status === 'failed' && (!op.metadata?.userId || op.metadata.userId === userId)
    );
  }

  async retryFailed(): Promise<void> {
    const { userId } = useEncryptionStore.getState();
    const failed = this.queue.filter(
      op => op.status === 'failed' && (!op.metadata?.userId || op.metadata.userId === userId)
    );

    failed.forEach(op => {
      op.status = 'pending';
      op.retries = 0;
    });

    this.save();
    await this.process();
  }

  clear(): void {
    this.queue = [];
    this.save();
  }

  remove(operationId: string): void {
    this.queue = this.queue.filter(op => op.id !== operationId);
    this.save();
  }
}

// Singleton instance
export const syncQueue = new SyncQueue();
