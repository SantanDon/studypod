/**
 * Encryption and decryption functions using AES-256-GCM
 * 
 * Security features:
 * - Algorithm: AES-256-GCM (Galois/Counter Mode)
 * - IV: 96-bit random initialization vector (unique per encryption)
 * - Authentication: 128-bit authentication tag
 * - Authenticated encryption prevents tampering
 */

import { EncryptedData, EncryptionResult, DecryptionResult } from './types';
import { arrayBufferToBase64, base64ToArrayBuffer } from './utils';

// Encryption parameters
const IV_LENGTH = 12;   // 96 bits for GCM (recommended)
const TAG_LENGTH = 16;  // 128 bits for authentication tag

/**
 * Encrypt data using AES-256-GCM
 * 
 * @param data - Plaintext string to encrypt
 * @param key - CryptoKey derived from passphrase
 * @returns EncryptedData object with IV, ciphertext, and authentication tag
 */
export async function encrypt(
  data: string,
  key: CryptoKey
): Promise<EncryptedData> {
  try {
    // Generate unique IV for this encryption
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    
    // Encode plaintext as UTF-8
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);

    // Encrypt with AES-256-GCM
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encodedData
    );

    // Split ciphertext and authentication tag
    // GCM appends the tag to the ciphertext
    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, -TAG_LENGTH);
    const tag = encryptedArray.slice(-TAG_LENGTH);

    return {
      iv: arrayBufferToBase64(iv),
      salt: '', // Salt stored separately in key derivation
      ciphertext: arrayBufferToBase64(ciphertext),
      tag: arrayBufferToBase64(tag),
    };
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 * 
 * @param encryptedData - EncryptedData object with IV, ciphertext, and tag
 * @param key - CryptoKey derived from passphrase (must be same as encryption)
 * @returns Decrypted plaintext string
 * @throws Error if authentication fails or decryption fails
 */
export async function decrypt(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<string> {
  try {
    // Decode Base64 components
    const iv = base64ToArrayBuffer(encryptedData.iv);
    const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);
    const tag = base64ToArrayBuffer(encryptedData.tag);

    // Combine ciphertext and tag for GCM
    const combined = new Uint8Array(
      (ciphertext as ArrayBuffer).byteLength + (tag as ArrayBuffer).byteLength
    );
    combined.set(new Uint8Array(ciphertext), 0);
    combined.set(new Uint8Array(tag), (ciphertext as ArrayBuffer).byteLength);

    // Decrypt with AES-256-GCM
    // This will automatically verify the authentication tag
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      combined
    );

    // Decode UTF-8 plaintext
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    // Authentication failure or decryption error
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Authentication failed or wrong key'}`);
  }
}

/**
 * Encrypt data with error handling wrapper
 * Returns result object instead of throwing
 * 
 * @param data - Plaintext string to encrypt
 * @param key - CryptoKey derived from passphrase
 * @returns EncryptionResult with success flag and data or error
 */
export async function encryptSafe(
  data: string,
  key: CryptoKey
): Promise<EncryptionResult> {
  try {
    const encrypted = await encrypt(data, key);
    return {
      success: true,
      data: encrypted,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Encryption failed',
    };
  }
}

/**
 * Decrypt data with error handling wrapper
 * Returns result object instead of throwing
 * 
 * @param encryptedData - EncryptedData object
 * @param key - CryptoKey derived from passphrase
 * @returns DecryptionResult with success flag and data or error
 */
export async function decryptSafe(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<DecryptionResult> {
  try {
    const decrypted = await decrypt(encryptedData, key);
    return {
      success: true,
      data: decrypted,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
    };
  }
}

/**
 * Encrypt JSON data
 * Convenience function for encrypting objects
 * 
 * @param data - Any JSON-serializable data
 * @param key - CryptoKey derived from passphrase
 * @returns EncryptedData object
 */
export async function encryptJSON<T>(
  data: T,
  key: CryptoKey
): Promise<EncryptedData> {
  const jsonString = JSON.stringify(data);
  return encrypt(jsonString, key);
}

/**
 * Decrypt JSON data
 * Convenience function for decrypting objects
 * 
 * @param encryptedData - EncryptedData object
 * @param key - CryptoKey derived from passphrase
 * @returns Parsed JSON data
 */
export async function decryptJSON<T>(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<T> {
  const jsonString = await decrypt(encryptedData, key);
  return JSON.parse(jsonString) as T;
}
