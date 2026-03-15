/**
 * Type definitions for encryption module
 */

export interface EncryptedData {
  iv: string;           // Base64 encoded 96-bit IV
  salt: string;         // Base64 encoded salt
  ciphertext: string;   // Base64 encoded encrypted data
  tag: string;          // Base64 encoded authentication tag
}

export interface KeyDerivationParams {
  algorithm: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  saltLength: number;
}

export interface EncryptionResult {
  success: boolean;
  data?: EncryptedData;
  error?: string;
}

export interface DecryptionResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface KeyGenerationResult {
  key: CryptoKey;
  salt: Uint8Array;
}
