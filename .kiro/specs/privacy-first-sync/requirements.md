# Privacy-First Encrypted Cloud Sync - Requirements

## Overview

This document defines the requirements for implementing end-to-end encrypted cloud sync for StudyPodLM. The goal is to enable cross-device access to user notes while maintaining strict privacy guarantees - no external service should ever have access to unencrypted user data.

## User Stories

### 1. Account Creation and Authentication

**As a** privacy-conscious user  
**I want to** create an account using only a PIN or passphrase (no email required)  
**So that** I can access my notes from any device without sharing personal information

**Acceptance Criteria:**
- User can create account with PIN (4-8 digits) or passphrase (8+ characters)
- PIN/passphrase used to derive encryption keys locally
- No email or personal information required for basic account
- Account creation shows clear explanation of privacy guarantees
- User must confirm understanding that without recovery info, data is lost forever
- Account creation generates recovery key shown once and required to confirm

**Technical Requirements:**
- Use Web Crypto API for all cryptographic operations
- Derive master key from PIN/passphrase using PBKDF2-SHA256
- Set PBKDF2 iteration count to minimum 100,000 (equivalent to bcrypt cost factor 12)
- Generate 256-bit salt for key derivation
- Store salt publicly (with encrypted data), never the passphrase

### 2. Encryption and Data Protection

**As a** user who values privacy  
**I want all my data** to be encrypted before leaving my device  
**So that** even if the server is compromised, my notes remain unreadable

**Acceptance Criteria:**
- All data encrypted client-side before upload
- Server stores only encrypted blobs, never plaintext
- Each encryption operation uses unique initialization vector (IV)
- Encryption uses AES-256-GCM authenticated encryption
- Decryption verifies authentication tag before returning data
- Data integrity verified via SHA-256 checksum

**Technical Requirements:**
- Algorithm: AES-256-GCM (Galois/Counter Mode)
- IV: 96-bit random IV for each encryption
- Authentication tag: 128-bit authentication tag
- Key derivation: PBKDF2-SHA256 with 100,000 iterations
- Salt: 256-bit random salt stored with encrypted data
- Data format: `{ "iv": "...", "salt": "...", "ciphertext": "...", "tag": "..." }`

### 3. Key Derivation and Management

**As a** security-conscious user  
**I want my encryption keys** to be derived from my passphrase using secure methods  
**So that** even with computational advances, my data remains protected

**Acceptance Criteria:**
- Master key derived using PBKDF2 with SHA-256
- Minimum 100,000 iterations for key derivation
- Unique salt generated for each account
- Salt stored alongside encrypted data (not secret)
- Key derivation happens entirely client-side
- No key material ever transmitted over network

**Technical Requirements:**
```
Key Derivation Process:
1. Generate random 256-bit salt
2. Import passphrase as UTF-8 encoded key material
3. Derive master key using PBKDF2-SHA256
4. Use derived key for AES-256-GCM encryption
5. Store salt with encrypted data for later decryption
```

### 4. Cloud Sync Operations

**As a** user who uses multiple devices  
**I want my notes** to sync automatically when online  
**So that** I always have access to my latest data

**Acceptance Criteria:**
- Automatic sync when internet connection detected
- Manual sync trigger available
- Sync queue processes operations in order
- Failed operations retry with exponential backoff (max 3 retries)
- Sync status visible in UI at all times
- Data integrity verified after download via checksum

**Technical Requirements:**
- Sync queue stored in localStorage for offline support
- Exponential backoff: 1s, 2s, 4s between retries
- Content hash generated for each data item for version comparison
- Server stores encrypted data with metadata: `{ id, encryptedData, checksum, timestamp, version }`

### 5. Sync Status and Feedback

**As a** user  
**I want clear visibility** into my sync status  
**So that** I know when my data is safe and up-to-date

**Acceptance Criteria:**
- Sync indicator shows current status (synced, syncing, offline, error)
- Pending operations count displayed
- Last sync timestamp shown
- Error messages clear and actionable
- Conflict notifications when sync conflicts detected

**UI Requirements:**
- Status indicator: Green (synced), Yellow (syncing), Gray (offline), Red (error)
- Pending count badge on sync icon
- Tooltip shows last sync time and pending operations
- Error banner with retry option for failed operations

### 6. Conflict Detection and Resolution

**As a** user who edits on multiple devices  
**I want conflicts** to be detected and resolved appropriately  
**So that** I never lose data due to sync conflicts

**Acceptance Criteria:**
- Conflicts detected when same data modified on multiple devices
- Last-write-wins strategy for automatic resolution
- Manual merge option for important conflicts
- Conflict UI shows both versions clearly
- User can choose which version to keep
- Conflict history tracked for audit

**Technical Requirements:**
- Version tracking via content hash and timestamp
- Conflict detection: compare content hashes after sync
- Automatic resolution: keep version with later timestamp
- Manual resolution: present both versions to user with merge option

### 7. Recovery Key System

**As a** careful user  
**I want a recovery key** that allows account access if I forget my passphrase  
**So that** I don't lose access to my data permanently

**Acceptance Criteria:**
- 32-character recovery key generated during account creation
- Recovery key shown once and user must copy/confirm
- Recovery key required to complete account setup
- Recovery key can reset passphrase (keeps existing data)
- Recovery key format: 64 hexadecimal characters
- Recovery key hashed with bcrypt (cost factor 12) before storage

**Technical Requirements:**
```
Recovery Key Generation:
1. Generate 32 bytes of cryptographically random data
2. Convert to 64 hex characters
3. Hash using bcrypt with cost factor 12
4. Store hash on server (never the raw key)
5. Show raw key to user once, never stored
```

### 8. Backup Phrase (Mnemonic)

**As a** user who prefers memorable recovery options  
**I want a 12-word backup phrase** as an alternative to the recovery key  
**So that** I can recover my account more easily

**Acceptance Criteria:**
- 12-word BIP-39 mnemonic phrase generated
- Words selected from standard English wordlist
- Phrase can recover account instead of recovery key
- User must confirm phrase by entering words in order
- Clear warning that phrase should be stored securely
- Phrase never stored, only the hash

**Technical Requirements:**
- Use BIP-39 wordlist (2048 words)
- Generate 128-bit entropy → 12 words
- Derive recovery key from phrase using PBKDF2
- Hash phrase with bcrypt (cost factor 12) for verification

### 9. Email Recovery (Optional)

**As a** user who wants a fallback recovery option  
**I want to optionally set up email recovery**  
**So that** I can receive a recovery link if I lose all other options

**Acceptance Criteria:**
- Email recovery is optional, not required
- User provides email for recovery notifications only
- Recovery email contains encrypted recovery token
- Token expires after 24 hours
- Email recovery only works if user has set up email previously
- Clear explanation that email is only for notifications, not data access

**Technical Requirements:**
- Recovery token: 32-byte random, expires 24 hours
- Token encrypted with user's public key before email
- Server stores only encrypted token
- User must have access to email to complete recovery
- Email service integration via existing API

### 10. Offline Support

**As a** user who often works offline  
**I want my data** to be accessible and editable without internet  
**So that** I can continue working regardless of connectivity

**Acceptance Criteria:**
- All data accessible offline
- Edits queue for sync when back online
- Queue persists across browser sessions
- Offline indicator clearly visible
- Queue auto-processes when connection restored
- Manual queue clear option available

**Technical Requirements:**
- Service Worker for offline caching
- localStorage for queue persistence
- Online/offline event listeners
- Queue processing trigger on connection restore

### 11. Data Export and Import

**As a** user who wants data portability  
**I want to export my data** in encrypted or plaintext format  
**So that** I can backup my notes or move to another service

**Acceptance Criteria:**
- Export all data as single JSON file
- Export options: encrypted (requires passphrase to open) or plaintext
- Export includes all notebooks, sources, notes, and chat messages
- Import from backup file
- Import validates data integrity
- Large export shows progress indicator

**Technical Requirements:**
- Export format: JSON with metadata
- Encrypted export: same format as cloud storage
- Plaintext export: readable JSON
- Import validates checksum before accepting data

### 12. Storage Management

**As a** user with limited storage  
**I want to manage my storage usage  
**So that** I don't run out of space on my device or cloud quota

**Acceptance Criteria:**
- Storage usage displayed in settings
- Breakdown by data type (notebooks, sources, etc.)
- Option to delete old data
- Cloud storage quota tracking
- Local storage cleanup option
- Warning when storage near limit

**Technical Requirements:**
- Storage stats from existing `getStorageStats()`
- Per-item size tracking
- Compression for encrypted data
- Automatic cleanup of old sync queue entries

### 13. Selective Sync

**As a** user with many notebooks  
**I want to choose which notebooks sync to cloud  
**So that** I can manage storage and privacy

**Acceptance Criteria:**
- List of all notebooks with sync status
- Toggle sync on/off per notebook
- Local-only notebooks still accessible
- Sync status updates in real-time
- Bulk selection option
- Clear indicator of sync state

**Technical Requirements:**
- Per-notebook sync flag in metadata
- Sync filter applied during upload/download
- Local data preserved when sync disabled
- Re-enable sync merges changes

### 14. Security Logging

**As a** security-conscious user  
**I want to see a log of security events  
**So that** I can monitor for suspicious activity

**Acceptance Criteria:**
- Log of security-relevant events (login, sync, export, etc.)
- Events include timestamp and result
- Exportable log file
- Configurable log retention
- Clear explanation of each event type

**Technical Requirements:**
- Event types: account_created, login, sync, export, recovery_attempt, etc.
- Local storage for logs
- Log entry: `{ timestamp, eventType, success, details }`

### 15. Migration from Local Storage

**As an** existing user  
**I want my existing local data** to be migrated to encrypted sync  
**So that** I can start using sync without losing data

**Acceptance Criteria:**
- Existing local data detected on first login
- User prompted to migrate data
- Migration shows progress
- Original data preserved until migration complete
- Rollback option if migration fails
- Clear success/failure feedback

**Technical Requirements:**
- Detect existing localStorage data
- Batch encryption of existing data
- Progress tracking for large datasets
- Transaction: migrate or rollback completely
- Preserve original data until confirmed

### 16. Performance Requirements

**As a** user  
**I expect the app** to remain responsive during encryption and sync  
**So that** my workflow is not interrupted

**Acceptance Criteria:**
- Account creation: < 3 seconds
- Encryption/decryption: < 500ms for typical notebook
- Sync upload: < 2s for typical notebook
- UI remains responsive during operations
- Progress indicators for long operations

**Technical Requirements:**
- Web Workers for heavy encryption operations
- Chunked processing for large data
- Debounced sync for frequent changes
- Efficient state management

### 17. Privacy Guarantees

**As a** privacy-focused user  
**I want clear documentation** of what data is collected and how it's protected  
**So that** I can make an informed decision about using the service

**Acceptance Criteria:**
- Clear privacy policy explaining zero-knowledge architecture
- Documentation of what data server stores (encrypted blobs only)
- Explanation that server cannot decrypt user data
- No tracking, analytics, or data selling
- Open source code for transparency
- Regular security audits documented

**Technical Requirements:**
- Privacy policy page
- Architecture documentation
- Link to public repository
- Audit reports published

### 18. Error Handling

**As a** user  
**I want clear error messages** when something goes wrong  
**So that** I understand what happened and how to fix it

**Acceptance Criteria:**
- User-friendly error messages (no technical jargon)
- Actionable guidance for recovery
- Error logging for support
- Graceful degradation when features unavailable
- Retry options for transient errors

**Technical Requirements:**
- Error types: network, encryption, validation, recovery
- Error codes for support
- Retry logic for transient errors
- Fallback options where possible

### 19. Backward Compatibility

**As an** existing user  
**I want the option** to continue using local-only mode  
**So that** I can choose not to use cloud sync

**Acceptance Criteria:**
- Existing localStorage data preserved
- Option to enable sync later
- Clear UI for sync status
- No forced migration to cloud sync
- Local-only mode fully functional

**Technical Requirements:**
- Feature flag for sync enablement
- Existing data format unchanged
- Sync optional, not required
- Migration path when enabling sync

### 20. Security Best Practices

**As a** security-conscious user  
**I want the implementation** to follow security best practices  
**So that** my data is protected against known attacks

**Acceptance Criteria:**
- No sensitive data in logs or console
- Secure random number generation for all keys
- Constant-time comparison for sensitive values
- No caching of decrypted data in memory longer than needed
- Secure deletion of sensitive data from memory
- HTTPS required for all API calls

**Technical Requirements:**
- Use `window.crypto.getRandomValues()` for all randomness
- Use `crypto.subtle` for all cryptographic operations
- Constant-time comparison for authentication
- Memory zeroing where possible
- CSP headers for XSS protection

## Technical Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Device                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ User Input  │───▶│ Key Derivation   │───▶│ Encryption │ │
│  │ (PIN/Phrase)│    │ (PBKDF2-SHA256)  │    │ (AES-256)  │ │
│  └─────────────┘    └──────────────────┘    └────────────┘ │
│                                                   │         │
│                                                   ▼         │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ Decryption  │◀───│ Key Derivation   │◀───│ User Input │ │
│  │ (AES-256)   │    │ (PBKDF2-SHA256)  │    │ (PIN/Phrase)│
│  └─────────────┘    └──────────────────┘    └────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Cloud Server                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Stored Data Structure:                               │   │
│  │ {                                                   │   │
│  │   id: "notebook-123",                               │   │
│  │   encryptedData: "base64-encoded-encrypted-blob",   │   │
│  │   salt: "base64-encoded-salt",                      │   │
│  │   checksum: "sha256-hash",                          │   │
│  │   timestamp: 1234567890,                            │   │
│  │   version: 1                                        │   │
│  │ }                                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  - Server never sees: passphrase, keys, plaintext data     │
│  - Server stores: encrypted blobs + public metadata         │
│  - Server provides: sync, storage, authentication tokens   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Encryption Module** (`src/lib/encryption/`)
   - Key derivation functions
   - Encryption/decryption functions
   - Data integrity verification

2. **Recovery Module** (`src/lib/recovery/`)
   - Recovery key generation and validation
   - Backup phrase generation
   - Email recovery integration

3. **Sync Manager** (`src/lib/sync/`)
   - Queue management
   - Conflict detection and resolution
   - Cloud API integration

4. **State Stores** (`src/stores/`)
   - Sync state
   - Encryption state
   - Recovery state

5. **UI Components** (`src/components/encryption/`)
   - Account creation
   - Authentication
   - Recovery setup
   - Sync status

## Success Criteria

1. **Functional Requirements**
   - [ ] Account creation with PIN/passphrase works
   - [ ] Encryption/decryption functions correctly
   - [ ] Cloud sync works across devices
   - [ ] Recovery options function correctly
   - [ ] Offline mode works
   - [ ] Data export/import works

2. **Security Requirements**
   - [ ] Zero-knowledge architecture verified
   - [ ] Encryption uses recommended algorithms
   - [ ] Key derivation uses recommended parameters
   - [ ] No sensitive data in logs
   - [ ] Security audit passed

3. **Performance Requirements**
   - [ ] Account creation < 3 seconds
   - [ ] Encryption/decryption < 500ms
   - [ ] Sync upload < 2 seconds
   - [ ] UI remains responsive

4. **User Experience Requirements**
   - [ ] Clear privacy messaging
   - [ ] Intuitive recovery flow
   - [ ] Visible sync status
   - [ ] Helpful error messages

## Dependencies

- Web Crypto API (built into modern browsers)
- Existing localStorage infrastructure
- Cloud storage backend (Supabase, Firebase, or custom)
- Existing authentication patterns

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| User loses passphrase and recovery key | High | Clear warnings during account creation; email recovery option |
| Server compromise | Low | Zero-knowledge architecture; encrypted data useless without keys |
| Brute force attack | Medium | High iteration count (100,000+); rate limiting on auth |
| Data corruption | Medium | Checksum verification; automatic retry |
| Large data sync | Low | Chunked sync; compression; progress indicators |

## Timeline

- **Phase 1**: Core encryption module (1-2 days)
- **Phase 2**: Recovery system (1-2 days)
- **Phase 3**: Sync manager (2-3 days)
- **Phase 4**: UI components (2-3 days)
- **Phase 5**: Integration and testing (2-3 days)

**Total estimated time: 8-13 days**