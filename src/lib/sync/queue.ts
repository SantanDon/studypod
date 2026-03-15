/**
 * Sync queue management
 * 
 * Manages pending sync operations with retry logic and persistence.
 * Operations are stored in localStorage and processed when online.
 */

import { SyncOperation, SyncQueueStatus } from './types';
import { useEncryptionStore } from '@/stores/encryptionStore';

const STORAGE_KEY = 'sync_queue';
const MAX_RETRIES = 3;

/**
 * Sync Queue Manager
 * Handles queuing, processing, and retry logic for sync operations
 */
export class SyncQueue {
  private queue: SyncOperation[] = [];
  private processing = false;

  constructor() {
    this.load();
  }

  /**
   * Load queue from localStorage
   */
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

  /**
   * Save queue to localStorage
   */
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save sync queue:', error);
    }
  }

  /**
   * Add operation to queue
   * 
   * @param operation - Sync operation to add
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
    
    // Auto-process if not already processing
    if (!this.processing) {
      await this.process();
    }
  }

  /**
   * Process all pending operations
   * Executes operations sequentially with retry logic
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
          console.error(`Sync operation failed:`, error);
          
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

  /**
   * Execute a single sync operation
   * 
   * @param op - Operation to execute
   */
  private async executeOperation(op: SyncOperation): Promise<void> {
    // This will be implemented when we add cloud client
    // For now, just simulate success
    
    // TODO: Integrate with cloud client
    // const endpoint = `/api/sync/${op.entityType}`;
    // switch (op.type) {
    //   case 'create':
    //   case 'update':
    //     await fetch(endpoint, {
    //       method: 'POST',
    //       body: JSON.stringify(op),
    //     });
    //     break;
    //   case 'delete':
    //     await fetch(`${endpoint}/${op.entityId}`, {
    //       method: 'DELETE',
    //     });
    //     break;
    // }
  }

  /**
   * Delay helper for exponential backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   * 
   * @returns Status with counts and last sync time
   */
  getStatus(): SyncQueueStatus {
    const { userId } = useEncryptionStore.getState();
    const pending = this.queue.filter(
      op => op.status === 'pending' && (!op.metadata?.userId || op.metadata.userId === userId)
    ).length;
    const failed = this.queue.filter(
      op => op.status === 'failed' && (!op.metadata?.userId || op.metadata.userId === userId)
    ).length;
    const lastSync = this.queue.length > 0
      ? Math.max(...this.queue.map(op => op.timestamp))
      : null;
    
    return { pending, failed, lastSync };
  }

  /**
   * Get all operations
   * 
   * @returns Array of all operations
   */
  getAll(): SyncOperation[] {
    return [...this.queue];
  }

  /**
   * Get pending operations
   * 
   * @returns Array of pending operations
   */
  getPending(): SyncOperation[] {
    const { userId } = useEncryptionStore.getState();
    return this.queue.filter(
      op => op.status === 'pending' && (!op.metadata?.userId || op.metadata.userId === userId)
    );
  }

  /**
   * Get failed operations
   * 
   * @returns Array of failed operations
   */
  getFailed(): SyncOperation[] {
    const { userId } = useEncryptionStore.getState();
    return this.queue.filter(
      op => op.status === 'failed' && (!op.metadata?.userId || op.metadata.userId === userId)
    );
  }

  /**
   * Retry failed operations
   * Resets retry count and status
   */
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

  /**
   * Clear all operations
   * Use with caution - removes all pending and failed operations
   */
  clear(): void {
    this.queue = [];
    this.save();
  }

  /**
   * Remove specific operation
   * 
   * @param operationId - ID of operation to remove
   */
  remove(operationId: string): void {
    this.queue = this.queue.filter(op => op.id !== operationId);
    this.save();
  }
}

// Singleton instance
export const syncQueue = new SyncQueue();
