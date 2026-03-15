/**
 * Recovery key generation and validation
 * 
 * Recovery keys are 64 hex characters (32 bytes) that allow account recovery
 * if the user forgets their passphrase. Keys are hashed with PBKDF2 before storage.
 */

import { RecoveryKey, RecoveryResult } from './types';
import { encryptionService } from '@/services/encryptionService';
import { UserStorage } from '@/lib/encryption/userStorage';

const RECOVERY_KEY_LENGTH = 32; // 32 bytes = 64 hex characters

/**
 * Generate a cryptographically secure recovery key
 * 
 * @returns 64 hex character recovery key
 */
export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_LENGTH));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash recovery key for secure storage
 * Uses PBKDF2 with 100,000 iterations (same as password hashing)
 * 
 * @param key - Recovery key to hash
 * @returns Hashed recovery key
 */
export async function hashRecoveryKey(key: string): Promise<string> {
  return encryptionService.hashPassword(key);
}

/**
 * Verify recovery key against stored hash
 * 
 * @param inputKey - Recovery key provided by user
 * @param storedHash - Stored hash to verify against
 * @returns True if key matches hash
 */
export async function verifyRecoveryKey(
  inputKey: string,
  storedHash: string
): Promise<boolean> {
  return encryptionService.verifyPassword(inputKey, storedHash);
}

/**
 * Validate recovery key format
 * Must be exactly 64 hex characters
 * 
 * @param key - Recovery key to validate
 * @returns True if format is valid
 */
export function validateRecoveryKeyFormat(key: string): boolean {
  // Must be 64 hex characters
  const hexPattern = /^[0-9a-f]{64}$/i;
  return hexPattern.test(key);
}

/**
 * Format recovery key for display
 * Splits into groups of 8 characters for readability
 * 
 * @param key - Recovery key to format
 * @returns Formatted key (e.g., "12345678-12345678-...")
 */
export function formatRecoveryKey(key: string): string {
  if (!validateRecoveryKeyFormat(key)) {
    throw new Error('Invalid recovery key format');
  }
  
  const groups: string[] = [];
  for (let i = 0; i < key.length; i += 8) {
    groups.push(key.substring(i, i + 8));
  }
  
  return groups.join('-');
}

/**
 * Parse formatted recovery key back to raw format
 * Removes dashes and validates
 * 
 * @param formattedKey - Formatted key with dashes
 * @returns Raw recovery key
 */
export function parseRecoveryKey(formattedKey: string): string {
  const raw = formattedKey.replace(/-/g, '').toLowerCase();
  
  if (!validateRecoveryKeyFormat(raw)) {
    throw new Error('Invalid recovery key format');
  }
  
  return raw;
}

/**
 * Create recovery key object with hash
 * 
 * @param key - Raw recovery key
 * @returns RecoveryKey object with hash and metadata
 */
export async function createRecoveryKey(key: string): Promise<RecoveryKey> {
  if (!validateRecoveryKeyFormat(key)) {
    throw new Error('Invalid recovery key format');
  }
  
  const hash = await hashRecoveryKey(key);
  
  return {
    key,
    hash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Attempt recovery using recovery key
 * 
 * @param inputKey - Recovery key provided by user
 * @param storedHash - Stored hash from account
 * @returns RecoveryResult indicating success or failure
 */
export async function recoverWithKey(
  inputKey: string,
  storedHash: string
): Promise<RecoveryResult> {
  try {
    // Validate format
    if (!validateRecoveryKeyFormat(inputKey)) {
      return {
        success: false,
        error: 'Invalid recovery key format. Must be 64 hex characters.',
      };
    }
    
    // Verify against stored hash
    const isValid = await verifyRecoveryKey(inputKey, storedHash);
    
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid recovery key. Please check and try again.',
      };
    }
    
    return {
      success: true,
      method: 'recovery-key',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Recovery failed',
    };
  }
}

/**
 * Store recovery key in localStorage with user namespace
 * Only stores the hash, never the raw key
 * 
 * @param userId - User ID
 * @param hash - Hashed recovery key
 */
export function storeRecoveryKeyHash(userId: string, hash: string): void {
  const storage = new UserStorage(userId);
  storage.set('recovery_key_hash', hash);
}

/**
 * Retrieve recovery key hash from localStorage with user namespace
 * 
 * @param userId - User ID
 * @returns Stored hash or null if not found
 */
export function getRecoveryKeyHash(userId: string): string | null {
  const storage = new UserStorage(userId);
  return storage.get('recovery_key_hash');
}

/**
 * Check if user has recovery key set up
 * 
 * @param userId - User ID
 * @returns True if recovery key exists
 */
export function hasRecoveryKey(userId: string): boolean {
  return getRecoveryKeyHash(userId) !== null;
}

/**
 * Remove recovery key from storage
 * 
 * @param userId - User ID
 */
export function removeRecoveryKey(userId: string): void {
  const storage = new UserStorage(userId);
  storage.remove('recovery_key_hash');
}
