/**
 * Type definitions for recovery module
 */

export interface RecoveryKey {
  key: string;           // 64 hex characters (32 bytes)
  hash: string;          // bcrypt hash for verification
  createdAt: string;     // ISO timestamp
}

export interface BackupPhrase {
  phrase: string;        // 12-word BIP-39 mnemonic
  hash: string;          // bcrypt hash for verification
  createdAt: string;     // ISO timestamp
}

export interface RecoveryToken {
  token: string;         // UUID token
  userId: string;        // User ID
  expiresAt: number;     // Unix timestamp
  encryptedKey: string;  // Recovery key encrypted with user's public key
  createdAt: string;     // ISO timestamp
}

export interface EmailRecoveryConfig {
  email: string;
  enabled: boolean;
  verifiedAt: string | null;
}

export interface RecoveryOptions {
  hasRecoveryKey: boolean;
  hasBackupPhrase: boolean;
  hasEmailRecovery: boolean;
  emailRecoveryAddress?: string;
}

export interface RecoveryResult {
  success: boolean;
  method?: 'recovery-key' | 'backup-phrase' | 'email';
  error?: string;
}
