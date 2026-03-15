/**
 * Type definitions for sync manager
 */

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entityType: 'notebook' | 'source' | 'note' | 'chat' | 'flashcard' | 'quiz' | 'podcast';
  entityId: string;
  data?: unknown;
  timestamp: number;
  retries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata?: {
    userId: string;
    entityType?: string;
    entityId?: string;
    timestamp: number;
  };
}

export interface VersionInfo {
  id: string;
  checksum: string;
  timestamp: number;
  version: number;
  data: unknown;
}

export interface ConflictInfo {
  entityId: string;
  entityType: string;
  localVersion: VersionInfo;
  remoteVersion: VersionInfo;
  detectedAt: number;
  resolved: boolean;
}

export interface SyncMetadata {
  lastSyncTimestamp: number;
  lastSyncVersion: number;
  syncEnabled: boolean;
  selectedNotebooks: string[]; // Empty means all
  conflictResolution: 'local' | 'remote' | 'manual';
}

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingOperations: number;
  conflicts: ConflictInfo[];
  error: string | null;
}

export interface SyncQueueStatus {
  pending: number;
  failed: number;
  lastSync: number | null;
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  conflicts: number;
  error?: string;
}
