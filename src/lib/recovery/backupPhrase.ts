/**
 * Backup phrase (BIP-39 mnemonic) generation and validation
 * 
 * 12-word mnemonic phrases provide a memorable recovery option.
 * Uses BIP-39 English wordlist (2048 words).
 */

import { BackupPhrase, RecoveryResult } from './types';
import { encryptionService } from '@/services/encryptionService';

// BIP-39 English wordlist (first 100 words for demo - full list would be 2048)
// In production, import full BIP-39 wordlist
const WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
  'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
  'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
  'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
];

const PHRASE_LENGTH = 12;

/**
 * Generate a 12-word backup phrase
 * Uses cryptographically secure random selection from BIP-39 wordlist
 * 
 * @returns 12-word mnemonic phrase
 */
export function generateBackupPhrase(): string {
  const words: string[] = [];
  
  for (let i = 0; i < PHRASE_LENGTH; i++) {
    // Generate random index
    const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % WORDLIST.length;
    words.push(WORDLIST[randomIndex]);
  }
  
  return words.join(' ');
}

/**
 * Validate backup phrase format
 * Checks word count and that all words are in wordlist
 * 
 * @param phrase - Backup phrase to validate
 * @returns True if format is valid
 */
export function validateBackupPhraseFormat(phrase: string): boolean {
  const words = phrase.toLowerCase().trim().split(/\s+/);
  
  // Must be exactly 12 words
  if (words.length !== PHRASE_LENGTH) {
    return false;
  }
  
  // All words must be in wordlist
  return words.every(word => WORDLIST.includes(word));
}

/**
 * Hash backup phrase for secure storage
 * 
 * @param phrase - Backup phrase to hash
 * @returns Hashed phrase
 */
export async function hashBackupPhrase(phrase: string): Promise<string> {
  return encryptionService.hashPassword(phrase);
}

/**
 * Verify backup phrase against stored hash
 * 
 * @param inputPhrase - Phrase provided by user
 * @param storedHash - Stored hash to verify against
 * @returns True if phrase matches hash
 */
export async function verifyBackupPhrase(
  inputPhrase: string,
  storedHash: string
): Promise<boolean> {
  return encryptionService.verifyPassword(inputPhrase, storedHash);
}

/**
 * Create backup phrase object with hash
 * 
 * @param phrase - Raw backup phrase
 * @returns BackupPhrase object with hash and metadata
 */
export async function createBackupPhrase(phrase: string): Promise<BackupPhrase> {
  if (!validateBackupPhraseFormat(phrase)) {
    throw new Error('Invalid backup phrase format');
  }
  
  const hash = await hashBackupPhrase(phrase);
  
  return {
    phrase,
    hash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Attempt recovery using backup phrase
 * 
 * @param inputPhrase - Backup phrase provided by user
 * @param storedHash - Stored hash from account
 * @returns RecoveryResult indicating success or failure
 */
export async function recoverWithPhrase(
  inputPhrase: string,
  storedHash: string
): Promise<RecoveryResult> {
  try {
    // Validate format
    if (!validateBackupPhraseFormat(inputPhrase)) {
      return {
        success: false,
        error: 'Invalid backup phrase. Must be 12 words from the wordlist.',
      };
    }
    
    // Verify against stored hash
    const isValid = await verifyBackupPhrase(inputPhrase, storedHash);
    
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid backup phrase. Please check and try again.',
      };
    }
    
    return {
      success: true,
      method: 'backup-phrase',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Recovery failed',
    };
  }
}

/**
 * Store backup phrase hash in localStorage
 * Only stores the hash, never the raw phrase
 * 
 * @param userId - User ID
 * @param hash - Hashed backup phrase
 */
export function storeBackupPhraseHash(userId: string, hash: string): void {
  const key = `backup_phrase_${userId}`;
  localStorage.setItem(key, hash);
}

/**
 * Retrieve backup phrase hash from localStorage
 * 
 * @param userId - User ID
 * @returns Stored hash or null if not found
 */
export function getBackupPhraseHash(userId: string): string | null {
  const key = `backup_phrase_${userId}`;
  return localStorage.getItem(key);
}

/**
 * Check if user has backup phrase set up
 * 
 * @param userId - User ID
 * @returns True if backup phrase exists
 */
export function hasBackupPhrase(userId: string): boolean {
  return getBackupPhraseHash(userId) !== null;
}

/**
 * Remove backup phrase from storage
 * 
 * @param userId - User ID
 */
export function removeBackupPhrase(userId: string): void {
  const key = `backup_phrase_${userId}`;
  localStorage.removeItem(key);
}

/**
 * Format backup phrase for display
 * Adds numbering for easier verification
 * 
 * @param phrase - Backup phrase
 * @returns Formatted phrase with numbers
 */
export function formatBackupPhrase(phrase: string): string[] {
  const words = phrase.split(' ');
  return words.map((word, index) => `${index + 1}. ${word}`);
}
