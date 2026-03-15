/**
 * Key derivation functions using PBKDF2-SHA256
 * 
 * Security parameters:
 * - Algorithm: PBKDF2 with SHA-256
 * - Iterations: 100,000 (equivalent to bcrypt cost factor 12)
 * - Salt length: 256 bits (32 bytes)
 * - Output key: 256 bits for AES-256-GCM
 */

import { KeyDerivationParams, KeyGenerationResult } from './types';
import { uint8ArrayToBase64, base64ToUint8Array } from './utils';

// Security parameters matching bcrypt cost factor 12
export const KEY_DERIVATION_PARAMS: KeyDerivationParams = {
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 100000,
  saltLength: 32, // 256 bits
};

/**
 * Generate a cryptographically secure random salt
 * @returns 256-bit salt as Uint8Array
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_DERIVATION_PARAMS.saltLength));
}

/**
 * Derive a master encryption key from a passphrase
 * 
 * @param passphrase - User's passphrase (PIN or password)
 * @param salt - 256-bit salt (must be same for decryption)
 * @returns CryptoKey suitable for AES-256-GCM encryption
 */
export async function deriveMasterKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Encode passphrase as UTF-8
  const encoder = new TextEncoder();
  const passphraseBuffer = encoder.encode(passphrase);

  // Import passphrase as key material
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    passphraseBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-256-GCM key using PBKDF2
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: KEY_DERIVATION_PARAMS.algorithm,
      salt,
      iterations: KEY_DERIVATION_PARAMS.iterations,
      hash: KEY_DERIVATION_PARAMS.hash,
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false, // Not extractable for security
    ['encrypt', 'decrypt']
  );

  return derivedKey;
}

/**
 * Generate a new encryption key from a passphrase
 * Creates a new salt and derives the key
 * 
 * @param passphrase - User's passphrase
 * @returns Object containing the derived key and salt
 */
export async function generateKeyFromPassphrase(
  passphrase: string
): Promise<KeyGenerationResult> {
  const salt = generateSalt();
  const key = await deriveMasterKey(passphrase, salt);
  
  return { key, salt };
}

/**
 * Derive key from passphrase with Base64-encoded salt
 * Convenience function for working with stored salt strings
 * 
 * @param passphrase - User's passphrase
 * @param saltBase64 - Base64-encoded salt string
 * @returns Derived CryptoKey
 */
export async function deriveKeyFromBase64Salt(
  passphrase: string,
  saltBase64: string
): Promise<CryptoKey> {
  const salt = base64ToUint8Array(saltBase64);
  return deriveMasterKey(passphrase, salt);
}

/**
 * Export salt as Base64 string for storage
 * 
 * @param salt - Salt as Uint8Array
 * @returns Base64-encoded salt string
 */
export function exportSalt(salt: Uint8Array): string {
  return uint8ArrayToBase64(salt);
}
