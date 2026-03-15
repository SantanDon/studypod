/**
 * Cloud storage client for encrypted sync
 * 
 * Handles communication with cloud storage backend.
 * All data is encrypted before upload, server only stores encrypted blobs.
 */

import { EncryptedData } from '../encryption/types';
import { generateChecksum } from '../encryption/integrity';

export interface EncryptedEntity {
  id: string;
  userId: string;
  type: 'notebook' | 'source' | 'note' | 'chat' | 'flashcard' | 'quiz' | 'podcast';
  encryptedData: string;      // Base64 encoded encrypted blob
  salt: string;               // Base64 encoded salt
  checksum: string;           // SHA-256 hash of plaintext
  version: number;            // Optimistic locking
  createdAt: string;          // ISO date
  updatedAt: string;          // ISO date
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface CloudClientConfig {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Cloud storage client
 * Communicates with backend API for sync operations
 */
export class CloudClient {
  private config: CloudClientConfig;

  constructor(config: CloudClientConfig) {
    this.config = config;
  }

  /**
   * Make HTTP request to API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Upload encrypted entity to cloud
   * 
   * @param entity - Encrypted entity to upload
   * @returns Uploaded entity with server metadata
   */
  async upload(entity: EncryptedEntity): Promise<EncryptedEntity> {
    return this.request<EncryptedEntity>('/api/sync', {
      method: 'POST',
      body: JSON.stringify(entity),
    });
  }

  /**
   * Download encrypted entity from cloud
   * 
   * @param entityId - Entity ID to download
   * @returns Encrypted entity or null if not found
   */
  async download(entityId: string): Promise<EncryptedEntity | null> {
    try {
      return await this.request<EncryptedEntity>(`/api/sync/${entityId}`);
    } catch (error) {
      // Return null if not found
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all entities for current user
   * 
   * @param userId - User ID
   * @returns Array of encrypted entities
   */
  async list(userId: string): Promise<EncryptedEntity[]> {
    return this.request<EncryptedEntity[]>(`/api/sync?userId=${userId}`);
  }

  /**
   * Delete entity from cloud
   * 
   * @param entityId - Entity ID to delete
   */
  async delete(entityId: string): Promise<void> {
    await this.request<void>(`/api/sync/${entityId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get sync status from server
   * 
   * @param userId - User ID
   * @returns Sync status information
   */
  async getStatus(userId: string): Promise<{
    lastSync: number;
    pendingUploads: number;
    pendingDownloads: number;
  }> {
    return this.request(`/api/sync/status?userId=${userId}`);
  }

  /**
   * Batch upload multiple entities
   * 
   * @param entities - Array of entities to upload
   * @returns Array of uploaded entities
   */
  async batchUpload(entities: EncryptedEntity[]): Promise<EncryptedEntity[]> {
    return this.request<EncryptedEntity[]>('/api/sync/batch', {
      method: 'POST',
      body: JSON.stringify({ entities }),
    });
  }

  /**
   * Batch download multiple entities
   * 
   * @param entityIds - Array of entity IDs to download
   * @returns Array of encrypted entities
   */
  async batchDownload(entityIds: string[]): Promise<EncryptedEntity[]> {
    return this.request<EncryptedEntity[]>('/api/sync/batch', {
      method: 'POST',
      body: JSON.stringify({ entityIds }),
    });
  }

  /**
   * Check if server is reachable
   * 
   * @returns True if server is online
   */
  async ping(): Promise<boolean> {
    try {
      await this.request('/api/ping');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create encrypted entity from data
 * 
 * @param id - Entity ID
 * @param userId - User ID
 * @param type - Entity type
 * @param encryptedData - Encrypted data object
 * @param salt - Salt used for encryption
 * @param plaintextChecksum - Checksum of plaintext data
 * @param version - Version number
 * @returns EncryptedEntity object
 */
export function createEncryptedEntity(
  id: string,
  userId: string,
  type: EncryptedEntity['type'],
  encryptedData: EncryptedData,
  salt: string,
  plaintextChecksum: string,
  version: number = 1
): EncryptedEntity {
  // Combine encrypted data into single blob
  const blob = JSON.stringify(encryptedData);
  
  return {
    id,
    userId,
    type,
    encryptedData: blob,
    salt,
    checksum: plaintextChecksum,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
}

/**
 * Parse encrypted entity back to encrypted data
 * 
 * @param entity - Encrypted entity
 * @returns EncryptedData object
 */
export function parseEncryptedEntity(entity: EncryptedEntity): EncryptedData {
  return JSON.parse(entity.encryptedData) as EncryptedData;
}

// Default cloud client instance (will be configured at runtime)
let defaultClient: CloudClient | null = null;

/**
 * Initialize default cloud client
 * 
 * @param config - Client configuration
 */
export function initializeCloudClient(config: CloudClientConfig): void {
  defaultClient = new CloudClient(config);
}

/**
 * Get default cloud client instance
 * 
 * @returns CloudClient instance
 * @throws Error if not initialized
 */
export function getCloudClient(): CloudClient {
  if (!defaultClient) {
    throw new Error('Cloud client not initialized. Call initializeCloudClient() first.');
  }
  return defaultClient;
}
