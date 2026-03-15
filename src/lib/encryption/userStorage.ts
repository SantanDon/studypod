/**
 * User-Namespaced localStorage Utility
 * 
 * Provides user-specific localStorage operations with automatic namespacing.
 * Format: user:{userId}:{key}
 * 
 * This ensures complete data isolation between multiple users on the same device.
 */

export interface UserMetadata {
  hasEncryption: boolean;
  createdAt?: string;
}

/**
 * UserStorage class for user-namespaced localStorage operations
 */
export class UserStorage {
  constructor(private userId: string) {
    if (!userId) {
      throw new Error('UserStorage requires a valid userId');
    }
  }

  /**
   * Generate namespaced key format: user:{userId}:{key}
   */
  private getKey(key: string): string {
    return `user:${this.userId}:${key}`;
  }

  /**
   * Set a value in localStorage with user namespace
   */
  set(key: string, value: string): void {
    localStorage.setItem(this.getKey(key), value);
  }

  /**
   * Get a value from localStorage with user namespace
   */
  get(key: string): string | null {
    return localStorage.getItem(this.getKey(key));
  }

  /**
   * Remove a value from localStorage with user namespace
   */
  remove(key: string): void {
    localStorage.removeItem(this.getKey(key));
  }

  /**
   * List all keys for this user (without namespace prefix)
   */
  listKeys(): string[] {
    const prefix = `user:${this.userId}:`;
    const keys: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keys.push(key.substring(prefix.length));
      }
    }
    
    return keys;
  }

  /**
   * Clear all data for this user
   */
  clear(): void {
    const prefix = `user:${this.userId}:`;
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

/**
 * Global function to list all user IDs stored on this device
 */
export function listAllUserIds(): string[] {
  const userIds = new Set<string>();
  const prefix = 'user:';
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        userIds.add(parts[1]);
      }
    }
  }
  
  return Array.from(userIds);
}

/**
 * Get metadata for a specific user
 */
export function getUserMetadata(userId: string): UserMetadata {
  const storage = new UserStorage(userId);
  
  return {
    hasEncryption: storage.get('encryption_salt') !== null,
    createdAt: storage.get('created_at') || undefined,
  };
}

/**
 * Check if a user exists on this device
 */
export function userExists(userId: string): boolean {
  const storage = new UserStorage(userId);
  return storage.get('encryption_salt') !== null;
}

/**
 * Get the current active user ID
 */
export function getCurrentUserId(): string | null {
  return localStorage.getItem('current_user_id');
}

/**
 * Set the current active user ID
 */
export function setCurrentUserId(userId: string): void {
  localStorage.setItem('current_user_id', userId);
}

/**
 * Clear the current active user ID
 */
export function clearCurrentUserId(): void {
  localStorage.removeItem('current_user_id');
}

/**
 * Delete a user and all their encrypted data
 */
export function deleteUser(userId: string): void {
  const storage = new UserStorage(userId);
  storage.clear();
  
  // If the deleted user is the current user, clear the session
  if (getCurrentUserId() === userId) {
    clearCurrentUserId();
  }
}
