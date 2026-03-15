# Privacy-First Encrypted Cloud Sync - Design Document

## Architecture Overview

The system implements a zero-knowledge architecture where all encryption/decryption happens client-side. The server stores only encrypted blobs and never has access to plaintext data or encryption keys.

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   UI Layer   │  │ State Stores │  │  Encryption Module   │  │
│  │  (React)     │  │  (Zustand)   │  │  (Web Crypto API)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └────────────────┼──────────────────────┘              │
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Sync Manager                                │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │   │
│  │  │ Queue      │ │ Conflict   │ │ Cloud API          │  │   │
│  │  │ Manager    │ │ Resolution │ │ Client             │  │   │
│  │  └────────────┘ └────────────┘ └────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTPS + JSON
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Cloud Storage API                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Stored Data Format:                                      │   │
│  │  {                                                        │   │
│  │    id: "uuid",                                            │   │
│  │    userId: "uuid",                                        │   │
│  │    type: "notebook|source|note|chat",                     │   │
│  │    encryptedData: "base64...",  // AES-256-GCM encrypted │   │
│  │    salt: "base64...",        // 256-bit salt             │   │
│  │    checksum: "sha256...",    // SHA-256 hash             │   │
│  │    version: 1,                 // Optimistic locking     │   │
│  │    createdAt: "iso-date",                                 │   │
│  │    updatedAt: "iso-date"                                  │   │
│  │  }                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  - Server never sees: passphrase, keys, plaintext              │
│  - Server provides: authentication, storage, sync               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Encryption Module Design

### Key Derivation

The encryption system uses PBKDF2-SHA256 for key derivation from the user's passphrase.

```typescript
// src/lib/encryption/keyDerivation.ts

interface KeyDerivationParams {
  algorithm: 'PBKDF2';
  hash: 'SHA-256';
  iterations: 100000;
  saltLength: 32; // 256 bits
}

const PARAMS: KeyDerivationParams = {
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 100000,
  saltLength: 32,
};

export async function generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(PARAMS.saltLength));
}

export async function deriveMasterKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PARAMS.iterations,
      hash: PARAMS.hash,
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateKeyFromPassphrase(passphrase: string): Promise<{
  key: CryptoKey;
  salt: Uint8Array;
}> {
  const salt = await generateSalt();
  const key = await deriveMasterKey(passphrase, salt);
  return { key, salt };
}
```

### Encryption/Decryption

Uses AES-256-GCM for authenticated encryption.

```typescript
// src/lib/encryption/encryption.ts

interface EncryptedData {
  iv: string;           // Base64 encoded 96-bit IV
  salt: string;         // Base64 encoded salt
  ciphertext: string;   // Base64 encoded encrypted data
  tag: string;          // Base64 encoded authentication tag
}

const IV_LENGTH = 12;   // 96 bits for GCM
const TAG_LENGTH = 16;  // 128 bits

export async function encrypt(
  data: string,
  key: CryptoKey
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedData
  );

  // Split ciphertext and tag (last 16 bytes)
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -TAG_LENGTH);
  const tag = encryptedArray.slice(-TAG_LENGTH);

  return {
    iv: arrayBufferToBase64(iv),
    salt: '', // Salt stored separately
    ciphertext: arrayBufferToBase64(ciphertext),
    tag: arrayBufferToBase64(tag),
  };
}

export async function decrypt(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<string> {
  const iv = base64ToArrayBuffer(encryptedData.iv);
  const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);
  const tag = base64ToArrayBuffer(encryptedData.tag);

  // Combine ciphertext and tag
  const combined = new Uint8Array(ciphertext.byteLength + tag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(new Uint8Array(tag), ciphertext.byteLength);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
```

### Data Integrity

```typescript
// src/lib/encryption/integrity.ts

export async function generateChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  return arrayBufferToBase64(hashBuffer);
}

export async function verifyChecksum(
  data: string,
  expectedChecksum: string
): Promise<boolean> {
  const actualChecksum = await generateChecksum(data);
  return actualChecksum === expectedChecksum;
}
```

## Recovery Module Design

### Recovery Key System

```typescript
// src/lib/recovery/recoveryKey.ts

const RECOVERY_KEY_LENGTH = 32; // 32 bytes = 64 hex characters

export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_LENGTH));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashRecoveryKey(key: string): Promise<string> {
  // Use bcrypt via existing encryptionService
  return encryptionService.hashPassword(key);
}

export async function verifyRecoveryKey(
  inputKey: string,
  storedHash: string
): Promise<boolean> {
  return encryptionService.verifyPassword(inputKey, storedHash);
}
```

### Backup Phrase (BIP-39)

```typescript
// src/lib/recovery/backupPhrase.ts

// BIP-39 English wordlist (2048 words)
const WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  // ... (full wordlist in implementation)
];

export function generateBackupPhrase(): string {
  // Generate 128 bits of entropy
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  
  // Convert to 12 words
  const words: string[] = [];
  let wordIndex = 0;
  
  for (let i = 0; i < 12; i++) {
    wordIndex = (entropy[i * 2] << 8) | entropy[i * 2 + 1];
    words.push(WORDLIST[wordIndex % 2048]);
  }
  
  return words.join(' ');
}

export function validateBackupPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().trim().split(/\s+/);
  if (words.length !== 12) return false;
  
  return words.every(word => WORDLIST.includes(word));
}
```

### Email Recovery

```typescript
// src/lib/recovery/emailRecovery.ts

interface RecoveryToken {
  token: string;
  userId: string;
  expiresAt: number;
  encryptedKey: string; // Recovery key encrypted with public key
}

export async function generateRecoveryToken(userId: string): Promise<RecoveryToken> {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  return {
    token,
    userId,
    expiresAt,
    encryptedKey: '', // Set after encryption
  };
}

export async function sendRecoveryEmail(
  email: string,
  userId: string
): Promise<void> {
  const token = await generateRecoveryToken(userId);
  
  // Encrypt token with user's public key (if available)
  // Otherwise, send link with token for client-side decryption
  
  await emailVerificationService.sendEmail(email, {
    subject: 'StudyPodLM Account Recovery',
    body: `Click here to recover your account: ${getRecoveryUrl(token)}`,
  });
}
```

## Sync Manager Design

### Sync Queue

```typescript
// src/lib/sync/queue.ts

interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entityType: 'notebook' | 'source' | 'note' | 'chat';
  entityId: string;
  data?: unknown;
  timestamp: number;
  retries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

class SyncQueue {
  private queue: SyncOperation[] = [];
  private readonly STORAGE_KEY = 'syncQueue';

  constructor() {
    this.load();
  }

  private load(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      this.queue = JSON.parse(stored);
    }
  }

  private save(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
  }

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
    await this.process();
  }

  async process(): Promise<void> {
    const pending = this.queue.filter(op => op.status === 'pending');
    
    for (const op of pending) {
      try {
        op.status = 'processing';
        this.save();
        
        await this.executeOperation(op);
        
        op.status = 'completed';
        this.save();
      } catch (error) {
        op.retries++;
        
        if (op.retries >= 3) {
          op.status = 'failed';
        }
        
        this.save();
        
        // Exponential backoff
        await this.delay(Math.pow(2, op.retries) * 1000);
      }
    }
    
    // Clean up completed operations
    this.queue = this.queue.filter(op => op.status !== 'completed');
    this.save();
  }

  private async executeOperation(op: SyncOperation): Promise<void> {
    const endpoint = `/api/sync/${op.entityType}`;
    
    switch (op.type) {
      case 'create':
      case 'update':
        await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(op),
        });
        break;
      case 'delete':
        await fetch(`${endpoint}/${op.entityId}`, {
          method: 'DELETE',
        });
        break;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus(): { pending: number; failed: number; lastSync: number | null } {
    const pending = this.queue.filter(op => op.status === 'pending').length;
    const failed = this.queue.filter(op => op.status === 'failed').length;
    const lastSync = this.queue.length > 0
      ? Math.max(...this.queue.map(op => op.timestamp))
      : null;
    
    return { pending, failed, lastSync };
  }
}

export const syncQueue = new SyncQueue();
```

### Conflict Detection and Resolution

```typescript
// src/lib/sync/conflict.ts

interface VersionInfo {
  id: string;
  checksum: string;
  timestamp: number;
  data: unknown;
}

export function detectConflict(
  local: VersionInfo,
  remote: VersionInfo
): boolean {
  // If checksums match, no conflict
  if (local.checksum === remote.checksum) {
    return false;
  }
  
  // If remote is older, local wins
  if (remote.timestamp < local.timestamp) {
    return false;
  }
  
  // Checksums differ and remote is newer - conflict!
  return true;
}

export async function resolveConflict(
  local: VersionInfo,
  remote: VersionInfo,
  strategy: 'local' | 'remote' | 'merge' = 'local'
): Promise<VersionInfo> {
  switch (strategy) {
    case 'local':
      return local;
    case 'remote':
      return remote;
    case 'merge':
      return performMerge(local, remote);
    default:
      // Last-write-wins
      return local.timestamp > remote.timestamp ? local : remote;
  }
}

async function performMerge(
  local: VersionInfo,
  remote: VersionInfo
): Promise<VersionInfo> {
  // For notebooks, merge is complex - for now, use last-write-wins
  // Future: implement intelligent merge for text content
  return local.timestamp > remote.timestamp ? local : remote;
}
```

## Data Models

### Encrypted Data Structure

```typescript
// src/lib/encryption/encryptedStorage.ts

interface EncryptedEntity {
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

interface EncryptedStorage {
  [entityId: string]: EncryptedEntity;
}
```

### Sync Metadata

```typescript
// src/lib/sync/syncTypes.ts

interface SyncMetadata {
  lastSyncTimestamp: number;
  lastSyncVersion: number;
  syncEnabled: boolean;
  selectedNotebooks: string[]; // Empty means all
  conflictResolution: 'local' | 'remote' | 'merge';
}

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingOperations: number;
  conflicts: ConflictInfo[];
  error: string | null;
}

interface ConflictInfo {
  entityId: string;
  entityType: string;
  localVersion: number;
  remoteVersion: number;
  localChecksum: string;
  remoteChecksum: string;
  localData: unknown;
  remoteData: unknown;
  detectedAt: number;
}
```

## API Design

### Cloud Storage API

```typescript
// src/lib/sync/cloudClient.ts

interface CloudClientConfig {
  baseUrl: string;
  apiKey: string;
}

class CloudClient {
  private config: CloudClientConfig;

  constructor(config: CloudClientConfig) {
    this.config = config;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }

  // Upload encrypted data
  async upload(entity: EncryptedEntity): Promise<EncryptedEntity> {
    return this.request('/api/sync', {
      method: 'POST',
      body: JSON.stringify(entity),
    });
  }

  // Download encrypted data
  async download(entityId: string): Promise<EncryptedEntity | null> {
    return this.request(`/api/sync/${entityId}`);
  }

  // Get all user data
  async list(): Promise<EncryptedEntity[]> {
    return this.request('/api/sync');
  }

  // Delete data
  async delete(entityId: string): Promise<void> {
    await this.request(`/api/sync/${entityId}`, {
      method: 'DELETE',
    });
  }

  // Get sync status
  async getStatus(): Promise<{
    lastSync: number;
    pendingUploads: number;
    pendingDownloads: number;
  }> {
    return this.request('/api/sync/status');
  }
}
```

## State Management Integration

### Sync Store (Zustand)

```typescript
// src/stores/syncStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingOperations: number;
  conflicts: ConflictInfo[];
  error: string | null;
  
  // Actions
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  addPendingOperation: () => void;
  removePendingOperation: () => void;
  addConflict: (conflict: ConflictInfo) => void;
  resolveConflict: (entityId: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: false,
      lastSyncTime: null,
      pendingOperations: 0,
      conflicts: [],
      error: null,

      setOnline: (online) => set({ isOnline: online }),
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      addPendingOperation: () => set((state) => ({
        pendingOperations: state.pendingOperations + 1
      })),
      removePendingOperation: () => set((state) => ({
        pendingOperations: Math.max(0, state.pendingOperations - 1)
      })),
      addConflict: (conflict) => set((state) => ({
        conflicts: [...state.conflicts, conflict]
      })),
      resolveConflict: (entityId) => set((state) => ({
        conflicts: state.conflicts.filter(c => c.entityId !== entityId)
      })),
      setError: (error) => set({ error }),
      reset: () => set({
        isSyncing: false,
        lastSyncTime: null,
        pendingOperations: 0,
        conflicts: [],
        error: null,
      }),
    }),
    {
      name: 'sync-store',
    }
  )
);
```

## Security Considerations

### Zero-Knowledge Architecture

1. **Passphrase never leaves device**: All key derivation happens client-side
2. **Server stores only encrypted data**: Even if compromised, data is unreadable
3. **No plaintext in logs**: All logging excludes sensitive data
4. **Constant-time comparisons**: Prevent timing attacks on authentication

### Encryption Parameters

| Operation | Algorithm | Parameters |
|-----------|-----------|------------|
| Key Derivation | PBKDF2-SHA256 | 100,000 iterations, 256-bit salt |
| Data Encryption | AES-256-GCM | 96-bit IV, 128-bit tag |
| Checksum | SHA-256 | - |
| Recovery Key Hash | bcrypt | Cost factor 12 |

### Attack Mitigations

| Attack Vector | Mitigation |
|---------------|------------|
| Brute force passphrase | High iteration count (100,000+) |
| Rainbow tables | Unique salt per account |
| Replay attacks | Timestamps and version numbers |
| Man-in-middle | HTTPS for all API calls |
| XSS | CSP headers, input sanitization |
| Timing attacks | Constant-time comparisons |

## Testing Strategy

### Unit Tests

```typescript
// src/lib/encryption/__tests__/keyDerivation.test.ts

describe('Key Derivation', () => {
  it('should generate unique salt each time', async () => {
    const salt1 = await generateSalt();
    const salt2 = await generateSalt();
    
    expect(salt1).not.toEqual(salt2);
  });

  it('should derive same key from same passphrase and salt', async () => {
    const passphrase = 'test-passphrase';
    const salt = await generateSalt();
    
    const key1 = await deriveMasterKey(passphrase, salt);
    const key2 = await deriveMasterKey(passphrase, salt);
    
    // Keys should be functionally equivalent
    expect(await encrypt('test', key1)).toEqual(await encrypt('test', key2));
  });

  it('should derive different keys from different passphrases', async () => {
    const salt = await generateSalt();
    
    const key1 = await deriveMasterKey('passphrase1', salt);
    const key2 = await deriveMasterKey('passphrase2', salt);
    
    const encrypted1 = await encrypt('test', key1);
    const encrypted2 = await encrypt('test', key2);
    
    expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
  });
});
```

### Property-Based Tests

```typescript
// src/lib/encryption/__tests__/encryption.properties.ts

import { fc, test } from '@fast-check/vitest';

describe('Encryption Properties', () => {
  test.prop([fc.string({ minLength: 0, maxLength: 1000 })])(
    'should round-trip encrypt/decrypt',
    async (plaintext) => {
      const { key, salt } = await generateKeyFromPassphrase('test-passphrase');
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      
      expect(decrypted).toEqual(plaintext);
    }
  );

  test.prop([fc.string(), fc.string()])(
    'should produce different ciphertext for same plaintext',
    async (passphrase, plaintext) => {
      const { key, salt } = await generateKeyFromPassphrase(passphrase);
      const encrypted1 = await encrypt(plaintext, key);
      const encrypted2 = await encrypt(plaintext, key);
      
      // Same plaintext should produce different ciphertext due to random IV
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
    }
  );
});
```

### Integration Tests

```typescript
// src/__tests__/integration/encryptedSync.test.ts

describe('Encrypted Sync Integration', () => {
  it('should create account, sync data, and recover', async () => {
    // 1. Create account
    const passphrase = 'test-passphrase-123';
    const { key, salt } = await generateKeyFromPassphrase(passphrase);
    
    // 2. Encrypt and upload data
    const notebook = { title: 'Test Notebook', content: 'Test content' };
    const encrypted = await encrypt(JSON.stringify(notebook), key);
    
    // 3. Simulate download and decrypt
    const decrypted = await decrypt(encrypted, key);
    const recovered = JSON.parse(decrypted);
    
    expect(recovered.title).toEqual('Test Notebook');
    expect(recovered.content).toEqual('Test content');
  });
});
```

## Implementation Roadmap

### Phase 1: Core Encryption (Days 1-2)

1. Create encryption module directory structure
2. Implement key derivation functions
3. Implement encryption/decryption functions
4. Implement data integrity functions
5. Write unit tests

### Phase 2: Recovery System (Days 3-4)

1. Create recovery module directory structure
2. Implement recovery key generation
3. Implement backup phrase generation
4. Implement email recovery integration
5. Write unit tests

### Phase 3: Sync Manager (Days 5-7)

1. Create sync manager directory structure
2. Implement sync queue management
3. Implement version control and conflict detection
4. Implement conflict resolution
5. Implement cloud sync operations
6. Write unit tests

### Phase 4: UI Components (Days 8-10)

1. Create account creation component
2. Create authentication component
3. Create recovery setup component
4. Create recovery access component
5. Create sync status component
6. Create selective sync component
7. Create data export/import component

### Phase 5: Integration (Days 11-13)

1. Wire encryption module to existing stores
2. Wire recovery module to existing auth
3. Wire sync manager to cloud storage
4. Wire UI components to state stores
5. Implement offline detection
6. Implement error handling UI
7. Integration testing

## Correctness Properties

### Property 1: Key Derivation Determinism
Given the same passphrase and salt, the derived key must always be identical.

### Property 2: Encryption/Decryption Round-Trip
For any plaintext string, encrypting then decrypting must return the original plaintext.

### Property 3: Unique Ciphertext
Encrypting the same plaintext with the same key must produce different ciphertext (due to random IV).

### Property 4: Sync Version Control
The version number must increment with each update, and conflicts must be detected when versions diverge.

### Property 5: Recovery Options
Recovery keys, backup phrases, and email recovery must all successfully restore access.

### Property 6: Data Integrity
The checksum must match for unmodified data and fail for modified data.

### Property 7: Migration and Security Logging
Migration must preserve all data, and security logs must not contain sensitive information.