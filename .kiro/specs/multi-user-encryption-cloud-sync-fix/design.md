# Multi-User Encryption and Cloud Sync Integration Bugfix Design

## Overview

This bugfix addresses critical multi-user isolation issues in the encryption system and completes the cloud sync integration. The root cause is that localStorage keys lack user-specific namespacing, causing all users on the same device to share encryption data. The fix introduces a user-namespaced localStorage architecture, an account selection/switching UI, proper routing integration for EncryptionFlow, sync triggers for data mutations, and a migration flow for existing users.

The solution ensures complete data isolation between users while maintaining backward compatibility for single-user scenarios and completing the 90% finished cloud sync feature.

## Glossary

- **Bug_Condition (C)**: The condition where localStorage keys lack user-specific namespacing, causing cross-user data access
- **Property (P)**: The desired behavior where each user's encryption data is isolated using namespaced keys
- **Preservation**: Existing single-user encryption, key derivation, and sync functionality that must remain unchanged
- **User Namespace**: A localStorage key prefix format `user:{userId}:` that isolates data per user
- **Account Context**: The currently active user session identified by userId
- **Migration Flow**: Process to convert existing non-namespaced localStorage data to user-namespaced format
- **Sync Trigger**: Hook-based mechanism to queue data mutations for cloud upload
- **EncryptionFlow**: Component that enforces authentication before accessing protected routes

## Bug Details

### Bug Condition

The bug manifests when multiple users attempt to use the application on the same device. The encryption system stores critical data (salt, recovery key hash, test value) in localStorage without user-specific namespacing, causing the second user to access the first user's encryption context.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { action: 'create_account' | 'sign_in', deviceHasExistingUser: boolean }
  OUTPUT: boolean
  
  RETURN input.deviceHasExistingUser = true
         AND localStorage.getItem('encryption_salt') exists
         AND NOT localStorage.getItem('encryption_salt').startsWith('user:')
         AND input.action IN ['create_account', 'sign_in']
END FUNCTION
```

### Examples

- User A creates encrypted account → stores `encryption_salt` in localStorage → User B signs in as guest → sees User A's authentication screen instead of guest mode
- User A with passphrase "password123" → User B with same passphrase → User B can decrypt User A's data (privacy violation)
- User A signs out → User B creates account → uses User A's salt → authentication fails or data corruption
- Existing user enables encryption → no migration flow → localStorage data remains unencrypted and unsynced


## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- AES-256-GCM encryption/decryption for single users must continue to work exactly as before
- PBKDF2-SHA256 key derivation with 100,000 iterations must remain unchanged
- Recovery key generation (64-character hex) and hashing must remain unchanged
- CloudClient API endpoints and request/response formats must remain unchanged
- Sync queue exponential backoff retry logic must remain unchanged
- Data export (encrypted and plaintext) must continue to work
- Offline sync queueing must continue to work
- Checksum verification for data integrity must remain unchanged
- In-memory key storage (never persisted) must remain unchanged
- Sign-out clearing of in-memory keys must remain unchanged

**Scope:**
All inputs that do NOT involve multi-user scenarios (single user on single device) should be completely unaffected by this fix. This includes:
- Single-user account creation and authentication
- Encryption/decryption operations
- Recovery key workflows
- Cloud sync operations for authenticated users
- Data export functionality

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Non-Namespaced localStorage Keys**: The system uses global keys like `encryption_salt`, `userId`, `recovery_key_hash` without user-specific prefixes
   - AccountCreation.tsx stores `localStorage.setItem('saltBase64', exportSalt(salt))`
   - Authentication.tsx retrieves `localStorage.getItem('encryption_salt')`
   - No userId prefix in key names

2. **Missing Account Context Management**: EncryptionFlow checks for `encryption_salt` existence without verifying which user it belongs to
   - `const hasEncryptionSalt = localStorage.getItem('encryption_salt')` in EncryptionFlow.tsx
   - No mechanism to list or switch between multiple user accounts

3. **Incomplete Routing Integration**: EncryptionFlow is not integrated into the application routing structure
   - No protected routes that require authentication
   - Users can access application without unlocking encryption

4. **Missing Sync Triggers**: Data mutations (notebook edits, source additions) don't trigger sync operations
   - No hooks in notebook components to call `syncManager.queueSync()`
   - Manual sync only, no automatic syncing on data changes

5. **No Migration Flow**: Existing users with localStorage data have no path to encrypt and sync their data
   - No UI to enable encryption for existing accounts
   - No migration utility to convert non-namespaced keys to namespaced format


## Correctness Properties

Property 1: Bug Condition - User-Namespaced localStorage Isolation

_For any_ user action where a user creates an account or signs in on a device with existing users, the fixed system SHALL store and retrieve all encryption-related data using user-namespaced localStorage keys in the format `user:{userId}:encryption_salt`, ensuring complete data isolation between users.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

Property 2: Preservation - Single-User Encryption Behavior

_For any_ single-user scenario where only one user exists on the device, the fixed system SHALL produce exactly the same encryption, decryption, and authentication behavior as the original system, preserving all existing cryptographic operations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.8, 3.9, 3.10**

Property 3: Cloud Sync Integration - Automatic Sync Triggers

_For any_ data mutation (notebook edit, source addition, deletion) performed by an authenticated user, the fixed system SHALL automatically queue the encrypted data for cloud sync using the useSyncManager hook, ensuring data is synchronized without manual intervention.

**Validates: Requirements 2.11**

Property 4: Migration Flow - Existing User Data Encryption

_For any_ existing user with unencrypted localStorage data who enables encryption, the fixed system SHALL provide a migration flow that encrypts all existing data, converts localStorage keys to user-namespaced format, and queues the data for cloud sync.

**Validates: Requirements 2.12**

Property 5: Account Management - Multi-Account Discovery

_For any_ device with multiple user accounts, the fixed system SHALL provide a UI component that lists all stored accounts and allows users to test passphrases to identify and switch between accounts.

**Validates: Requirements 2.13**


## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

### 1. User-Namespaced localStorage Architecture

**File**: `src/lib/encryption/userStorage.ts` (new file)

**Purpose**: Centralize all user-namespaced localStorage operations

**Implementation**:
```typescript
// User-namespaced localStorage utility
export class UserStorage {
  constructor(private userId: string) {}

  // Namespaced key format: user:{userId}:{key}
  private getKey(key: string): string {
    return `user:${this.userId}:${key}`;
  }

  set(key: string, value: string): void {
    localStorage.setItem(this.getKey(key), value);
  }

  get(key: string): string | null {
    return localStorage.getItem(this.getKey(key));
  }

  remove(key: string): void {
    localStorage.removeItem(this.getKey(key));
  }

  // List all keys for this user
  listKeys(): string[] {
    const prefix = `user:${this.userId}:`;
    return Object.keys(localStorage)
      .filter(key => key.startsWith(prefix))
      .map(key => key.substring(prefix.length));
  }
}

// Global functions for account discovery
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

export function getUserMetadata(userId: string): { hasEncryption: boolean; createdAt?: string } {
  const storage = new UserStorage(userId);
  return {
    hasEncryption: storage.get('encryption_salt') !== null,
    createdAt: storage.get('created_at') || undefined,
  };
}
```

### 2. Update AccountCreation Component

**File**: `src/components/encryption/AccountCreation.tsx`

**Specific Changes**:
1. **Import UserStorage**: Add `import { UserStorage } from '@/lib/encryption/userStorage'`
2. **Use Namespaced Storage**: Replace all `localStorage.setItem()` calls with `UserStorage` methods
3. **Store Creation Timestamp**: Add `storage.set('created_at', new Date().toISOString())`

**Code Example**:
```typescript
// Before
localStorage.setItem('userId', userId);
localStorage.setItem('saltBase64', exportSalt(salt));

// After
const storage = new UserStorage(userId);
storage.set('encryption_salt', exportSalt(salt));
storage.set('created_at', new Date().toISOString());
localStorage.setItem('current_user_id', userId); // Global pointer to current user
```

### 3. Update Authentication Component

**File**: `src/components/encryption/Authentication.tsx`

**Specific Changes**:
1. **Accept userId Prop**: Add `userId: string` to props
2. **Use Namespaced Storage**: Replace `localStorage.getItem('encryption_salt')` with `new UserStorage(userId).get('encryption_salt')`
3. **Verify Test Value**: Use namespaced key for `encryption_test`

**Code Example**:
```typescript
// Before
const storedSalt = localStorage.getItem('encryption_salt');

// After
const storage = new UserStorage(userId);
const storedSalt = storage.get('encryption_salt');
```


### 4. Account Selection/Switching UI

**File**: `src/components/encryption/AccountSelector.tsx` (new file)

**Purpose**: Allow users to discover, identify, and switch between multiple accounts

**Implementation**:
```typescript
interface AccountInfo {
  userId: string;
  hasEncryption: boolean;
  createdAt?: string;
  isLocked: boolean;
}

export function AccountSelector({ onAccountSelected }: { onAccountSelected: (userId: string) => void }) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [testingAccount, setTestingAccount] = useState<string | null>(null);
  const [testPassphrase, setTestPassphrase] = useState('');

  useEffect(() => {
    // Discover all accounts on device
    const userIds = listAllUserIds();
    const accountList = userIds.map(userId => ({
      userId,
      ...getUserMetadata(userId),
      isLocked: true,
    }));
    setAccounts(accountList);
  }, []);

  const handleTestPassphrase = async (userId: string) => {
    // Try to derive key and decrypt test value
    const storage = new UserStorage(userId);
    const salt = storage.get('encryption_salt');
    
    try {
      const key = await deriveMasterKey(testPassphrase, base64ToArrayBuffer(salt));
      const testValue = storage.get('encryption_test');
      await decrypt(testValue, key);
      
      // Success - this is the correct account
      onAccountSelected(userId);
    } catch {
      toast({ title: 'Incorrect passphrase', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Account</CardTitle>
        <CardDescription>
          {accounts.length} account(s) found on this device
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.map(account => (
          <div key={account.userId} className="border rounded p-4 mb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm">{account.userId.slice(0, 8)}...</p>
                <p className="text-xs text-muted-foreground">
                  Created: {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : 'Unknown'}
                </p>
              </div>
              <Button onClick={() => setTestingAccount(account.userId)}>
                Unlock
              </Button>
            </div>
            
            {testingAccount === account.userId && (
              <div className="mt-4 space-y-2">
                <Input
                  type="password"
                  placeholder="Enter passphrase to identify account"
                  value={testPassphrase}
                  onChange={(e) => setTestPassphrase(e.target.value)}
                />
                <Button onClick={() => handleTestPassphrase(account.userId)}>
                  Test Passphrase
                </Button>
              </div>
            )}
          </div>
        ))}
        
        <Button variant="outline" className="w-full mt-4" onClick={() => onAccountSelected('new')}>
          Create New Account
        </Button>
      </CardContent>
    </Card>
  );
}
```

### 5. Update EncryptionFlow Component

**File**: `src/components/encryption/EncryptionFlow.tsx`

**Specific Changes**:
1. **Add Account Selection State**: New flow state `'select-account'`
2. **Check for Multiple Accounts**: Use `listAllUserIds()` to detect multiple accounts
3. **Pass userId to Authentication**: Provide selected userId to Authentication component
4. **Handle Account Switching**: Allow users to switch between accounts

**Code Example**:
```typescript
// Add to flow states
type FlowState = 'loading' | 'select-account' | 'create-account' | 'authenticate' | ...;

useEffect(() => {
  const checkEncryptionSetup = () => {
    const userIds = listAllUserIds();
    const currentUserId = localStorage.getItem('current_user_id');
    
    if (isUnlocked) {
      setFlowState('unlocked');
      onUnlocked?.();
    } else if (userIds.length === 0) {
      // No accounts - show creation
      setFlowState('create-account');
    } else if (userIds.length > 1 || !currentUserId) {
      // Multiple accounts or no current user - show selector
      setFlowState('select-account');
    } else {
      // Single account - show authentication
      setSelectedUserId(currentUserId);
      setFlowState('authenticate');
    }
  };
  
  checkEncryptionSetup();
}, [isUnlocked, onUnlocked]);
```


### 6. Routing Integration for EncryptionFlow

**File**: `src/App.tsx` or `src/routes/index.tsx`

**Purpose**: Integrate EncryptionFlow into routing to enforce authentication

**Implementation**:
```typescript
// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isUnlocked } = useEncryptionStore();
  const [showEncryption, setShowEncryption] = useState(!isUnlocked);

  if (showEncryption) {
    return <EncryptionFlow onUnlocked={() => setShowEncryption(false)} />;
  }

  return <>{children}</>;
}

// Route configuration
<Routes>
  <Route path="/auth" element={<EncryptionFlow onUnlocked={() => navigate('/')} />} />
  
  <Route path="/" element={
    <ProtectedRoute>
      <NotebookLayout />
    </ProtectedRoute>
  } />
  
  <Route path="/notebook/:id" element={
    <ProtectedRoute>
      <NotebookView />
    </ProtectedRoute>
  } />
  
  {/* Guest mode - no protection */}
  <Route path="/guest" element={<GuestMode />} />
</Routes>
```

**Specific Changes**:
1. **Create ProtectedRoute Component**: Wrapper that checks `isUnlocked` state
2. **Wrap Protected Routes**: Apply to all routes that require encryption
3. **Add /auth Route**: Dedicated route for authentication flow
4. **Handle Guest Mode**: Separate route that bypasses encryption

### 7. Sync Triggers for Data Mutations

**File**: `src/hooks/useSyncTrigger.ts` (new file)

**Purpose**: Automatically trigger sync on data mutations

**Implementation**:
```typescript
export function useSyncTrigger() {
  const { isUnlocked, userId } = useEncryptionStore();
  const syncManager = getSyncManager();

  const triggerSync = useCallback(async (
    entityType: 'notebook' | 'source' | 'flashcard',
    entityId: string,
    data: any
  ) => {
    if (!isUnlocked || !userId) {
      console.warn('Cannot sync: user not authenticated');
      return;
    }

    await syncManager.queueSync(entityId, entityType, data);
  }, [isUnlocked, userId, syncManager]);

  return { triggerSync };
}
```

**File**: `src/stores/notebookStore.ts`

**Specific Changes**:
1. **Import useSyncTrigger**: Add sync trigger hook
2. **Trigger on Mutations**: Call `triggerSync()` after notebook updates
3. **Trigger on Source Addition**: Call `triggerSync()` when sources are added
4. **Trigger on Deletion**: Call `triggerSync()` with delete operation

**Code Example**:
```typescript
// In notebookStore
updateNotebook: (id, updates) => {
  set(state => ({
    notebooks: state.notebooks.map(nb => 
      nb.id === id ? { ...nb, ...updates } : nb
    )
  }));
  
  // Trigger sync
  const notebook = get().notebooks.find(nb => nb.id === id);
  if (notebook) {
    getSyncManager().queueSync(id, 'notebook', notebook);
  }
}
```

### 8. Update SyncManager for User Context

**File**: `src/lib/sync/syncManager.ts`

**Specific Changes**:
1. **Include userId in Metadata**: Add userId to encrypted entity metadata
2. **Filter by User**: Only sync data for current authenticated user
3. **Handle User Switching**: Clear queue when user switches

**Code Example**:
```typescript
async queueSync(entityId: string, entityType: string, data: any) {
  const { masterKey, userId } = useEncryptionStore.getState();
  
  if (!masterKey || !userId) {
    console.warn('Cannot queue sync: no encryption key or user context');
    return;
  }

  try {
    // Encrypt data
    const dataString = JSON.stringify(data);
    const encrypted = await encrypt(dataString, masterKey);

    // Add userId to metadata
    const metadata = {
      userId,
      entityType,
      entityId,
      timestamp: Date.now(),
    };

    // Add to queue with metadata
    await this.queue.add({
      type: 'update',
      entityType: entityType as any,
      entityId,
      data: encrypted,
      metadata, // Include user context
    });

    // Update pending count
    const status = this.queue.getStatus();
    useSyncStore.getState().setPendingOperations(status.pending);

    // Trigger immediate processing if online
    if (navigator.onLine) {
      this.processQueue();
    }
  } catch (error) {
    console.error('Failed to queue sync:', error);
  }
}
```


### 9. Data Migration Flow for Existing Users

**File**: `src/components/encryption/MigrationFlow.tsx` (new file)

**Purpose**: Migrate existing unencrypted localStorage data to encrypted, namespaced format

**Implementation**:
```typescript
interface MigrationFlowProps {
  onComplete: () => void;
}

export function MigrationFlow({ onComplete }: MigrationFlowProps) {
  const [step, setStep] = useState<'detect' | 'confirm' | 'migrating' | 'complete'>('detect');
  const [dataToMigrate, setDataToMigrate] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Detect non-namespaced data
    const legacyKeys = detectLegacyData();
    setDataToMigrate(legacyKeys);
    
    if (legacyKeys.length > 0) {
      setStep('confirm');
    } else {
      setStep('complete');
    }
  }, []);

  const detectLegacyData = (): string[] => {
    const legacyKeys: string[] = [];
    const knownKeys = ['notebooks', 'sources', 'flashcards', 'settings'];
    
    for (const key of knownKeys) {
      if (localStorage.getItem(key) && !key.startsWith('user:')) {
        legacyKeys.push(key);
      }
    }
    
    return legacyKeys;
  };

  const handleMigrate = async () => {
    setStep('migrating');
    const { masterKey, userId } = useEncryptionStore.getState();
    
    if (!masterKey || !userId) {
      throw new Error('No encryption context available');
    }

    const storage = new UserStorage(userId);
    const syncManager = getSyncManager();
    
    for (let i = 0; i < dataToMigrate.length; i++) {
      const key = dataToMigrate[i];
      const data = localStorage.getItem(key);
      
      if (data) {
        // Encrypt and store with namespaced key
        const encrypted = await encrypt(data, masterKey);
        storage.set(key, JSON.stringify(encrypted));
        
        // Queue for sync
        await syncManager.queueSync(key, key as any, JSON.parse(data));
        
        // Remove legacy key
        localStorage.removeItem(key);
      }
      
      setProgress(((i + 1) / dataToMigrate.length) * 100);
    }
    
    setStep('complete');
  };

  if (step === 'confirm') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrate Existing Data</CardTitle>
          <CardDescription>
            We found {dataToMigrate.length} items that need to be encrypted and synced
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This will encrypt your existing data and prepare it for cloud sync.
              Your original data will be backed up automatically.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-2">
            <p className="text-sm font-medium">Data to migrate:</p>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              {dataToMigrate.map(key => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
          
          <Button onClick={handleMigrate} className="w-full">
            Start Migration
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'migrating') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrating Data...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              {Math.round(progress)}% complete
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'complete') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Your data has been encrypted and queued for cloud sync
            </AlertDescription>
          </Alert>
          
          <Button onClick={onComplete} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
```

### 10. Update Recovery Key Storage

**File**: `src/lib/recovery/recoveryKey.ts`

**Specific Changes**:
1. **Use UserStorage**: Replace direct localStorage calls with UserStorage
2. **Accept userId Parameter**: All functions should accept userId
3. **Namespace Recovery Keys**: Store recovery key hash with user namespace

**Code Example**:
```typescript
// Before
export function storeRecoveryKeyHash(userId: string, hash: string) {
  localStorage.setItem('recovery_key_hash', hash);
}

// After
export function storeRecoveryKeyHash(userId: string, hash: string) {
  const storage = new UserStorage(userId);
  storage.set('recovery_key_hash', hash);
}
```


### 11. Update Encryption Store

**File**: `src/stores/encryptionStore.ts`

**Specific Changes**:
1. **Track Current User**: Store current userId in localStorage as global pointer
2. **Clear User Context on Logout**: Remove current_user_id on clearMasterKey
3. **Validate User Context**: Ensure userId matches current_user_id

**Code Example**:
```typescript
setMasterKey: (key, salt, userId) => {
  // Set current user as global pointer
  localStorage.setItem('current_user_id', userId);
  
  set({
    masterKey: key,
    salt,
    isUnlocked: true,
    userId,
  });
},

clearMasterKey: () => {
  // Clear current user pointer
  localStorage.removeItem('current_user_id');
  
  set({
    masterKey: null,
    salt: null,
    isUnlocked: false,
    userId: null,
  });
},
```

### 12. Update Sync Queue

**File**: `src/lib/sync/queue.ts`

**Specific Changes**:
1. **Add Metadata Field**: Include metadata in SyncOperation type
2. **Filter by User**: Only process operations for current user
3. **Persist User Context**: Store userId with queued operations

**Code Example**:
```typescript
interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entityType: 'notebook' | 'source' | 'flashcard';
  entityId: string;
  data: EncryptedData;
  metadata?: {
    userId: string;
    timestamp: number;
  };
  retryCount: number;
  lastAttempt?: number;
}

// Filter operations by current user
async process() {
  const { userId } = useEncryptionStore.getState();
  const operations = this.getOperations().filter(
    op => op.metadata?.userId === userId
  );
  
  // Process filtered operations...
}
```


## Architecture Diagrams

### User-Namespaced localStorage Structure

```
localStorage
├── current_user_id: "abc-123"                    # Global pointer to active user
├── user:abc-123:encryption_salt: "base64..."     # User A's salt
├── user:abc-123:encryption_test: "{...}"         # User A's test value
├── user:abc-123:recovery_key_hash: "hash..."     # User A's recovery hash
├── user:abc-123:created_at: "2026-01-15"         # User A's creation date
├── user:abc-123:notebooks: "[{...}]"             # User A's encrypted notebooks
├── user:abc-123:sources: "[{...}]"               # User A's encrypted sources
├── user:def-456:encryption_salt: "base64..."     # User B's salt
├── user:def-456:encryption_test: "{...}"         # User B's test value
├── user:def-456:recovery_key_hash: "hash..."     # User B's recovery hash
├── user:def-456:created_at: "2026-01-16"         # User B's creation date
├── user:def-456:notebooks: "[{...}]"             # User B's encrypted notebooks
└── user:def-456:sources: "[{...}]"               # User B's encrypted sources
```

### Multi-User Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Start                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              EncryptionFlow: Check Setup                     │
│  - Call listAllUserIds()                                     │
│  - Check current_user_id in localStorage                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
                ┌───────────┴───────────┐
                ↓                       ↓
    ┌───────────────────┐   ┌───────────────────┐
    │  No Users Found   │   │  Users Found      │
    └───────────────────┘   └───────────────────┘
                ↓                       ↓
    ┌───────────────────┐   ┌───────────────────┐
    │ AccountCreation   │   │ Multiple Users?   │
    │ - Generate userId │   └───────────────────┘
    │ - Create salt     │           ↓
    │ - Store with      │   ┌───────┴───────┐
    │   user: prefix    │   ↓               ↓
    └───────────────────┘  Yes             No
                            ↓               ↓
                ┌───────────────────┐   ┌───────────────────┐
                │ AccountSelector   │   │ Authentication    │
                │ - List accounts   │   │ - Use current     │
                │ - Test passphrase │   │   user's salt     │
                │ - Identify user   │   │ - Derive key      │
                └───────────────────┘   └───────────────────┘
                            ↓                       ↓
                            └───────────┬───────────┘
                                        ↓
                            ┌───────────────────────┐
                            │   User Authenticated  │
                            │ - Set current_user_id │
                            │ - Load user data      │
                            │ - Initialize sync     │
                            └───────────────────────┘
                                        ↓
                            ┌───────────────────────┐
                            │  Protected Routes     │
                            │  - Notebook access    │
                            │  - Data mutations     │
                            │  - Auto-sync triggers │
                            └───────────────────────┘
```

### Sync Trigger Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   User Action (Edit Notebook)                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              notebookStore.updateNotebook()                  │
│  - Update local state                                        │
│  - Persist to localStorage with user namespace               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              getSyncManager().queueSync()                    │
│  - Get masterKey and userId from encryptionStore             │
│  - Encrypt notebook data                                     │
│  - Add to sync queue with metadata { userId, timestamp }     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              SyncQueue.add()                                 │
│  - Store operation in queue with user context                │
│  - Update pending operations count                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              SyncManager.processQueue()                      │
│  - Filter operations by current userId                       │
│  - Upload to CloudClient with userId in metadata             │
│  - Retry with exponential backoff on failure                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              CloudClient.upload()                            │
│  - POST /api/sync/upload                                     │
│  - Body: { entityId, entityType, encryptedData, metadata }   │
│  - Server stores with userId association                     │
└─────────────────────────────────────────────────────────────┘
```

### Migration Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│          Existing User Enables Encryption                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              MigrationFlow: Detect Legacy Data               │
│  - Scan localStorage for non-namespaced keys                 │
│  - Identify: notebooks, sources, flashcards, settings        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Show Confirmation UI                            │
│  - List items to migrate                                     │
│  - Explain encryption and sync benefits                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              User Confirms Migration                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              For Each Legacy Item:                           │
│  1. Read from localStorage (non-namespaced key)              │
│  2. Encrypt with user's masterKey                            │
│  3. Store with user:userId:key format                        │
│  4. Queue for cloud sync                                     │
│  5. Remove legacy key                                        │
│  6. Update progress bar                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Migration Complete                              │
│  - All data encrypted and namespaced                         │
│  - Queued for cloud sync                                     │
│  - User can continue using app                               │
└─────────────────────────────────────────────────────────────┘
```


## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate multi-user scenarios on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Cross-User Data Access Test**: Create User A with passphrase "pass123", then create User B with same passphrase, verify User B can access User A's data (will fail on unfixed code - demonstrates privacy violation)
2. **localStorage Key Collision Test**: Create User A, check localStorage keys, create User B, verify User B's keys overwrite User A's keys (will fail on unfixed code)
3. **Account Discovery Test**: Create multiple users, attempt to list all accounts, verify only one set of encryption data exists (will fail on unfixed code)
4. **Sync User Context Test**: Create User A, queue sync operation, switch to User B, verify sync operation includes User A's data (will fail on unfixed code - demonstrates missing user context)

**Expected Counterexamples**:
- User B can decrypt User A's data when using the same passphrase
- localStorage contains only one `encryption_salt` key regardless of number of users
- Sync operations lack userId metadata
- No mechanism to discover or switch between multiple accounts

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := createAccount_fixed(input) OR signIn_fixed(input)
  ASSERT result.localStorage_keys.startsWith('user:' + input.userId)
  ASSERT result.data_isolation = true
  ASSERT result.sync_metadata.userId = input.userId
END FOR
```

**Test Cases**:
1. **User Namespace Isolation**: Create User A and User B, verify each has separate `user:{userId}:encryption_salt` keys
2. **Same Passphrase Different Data**: Create User A and User B with same passphrase, verify User B cannot decrypt User A's data
3. **Account Switching**: Sign in as User A, sign out, sign in as User B, verify correct data is loaded
4. **Sync User Context**: Create User A, edit notebook, verify sync queue includes userId in metadata
5. **Migration Flow**: Create legacy data, enable encryption, verify data is migrated to namespaced format

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT encrypt_original(input) = encrypt_fixed(input)
  ASSERT deriveMasterKey_original(input) = deriveMasterKey_fixed(input)
  ASSERT cloudClient_original(input) = cloudClient_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for single-user scenarios, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Single-User Encryption**: Create single user, encrypt data, verify encryption algorithm unchanged
2. **Key Derivation**: Test PBKDF2-SHA256 with 100,000 iterations produces same keys
3. **Recovery Key Generation**: Verify 64-character hex keys are generated correctly
4. **Cloud Sync API**: Verify CloudClient endpoints and request formats unchanged
5. **Offline Queue**: Verify sync queue retry logic with exponential backoff unchanged
6. **Data Export**: Verify encrypted and plaintext export functionality unchanged

### Unit Tests

- Test UserStorage class methods (set, get, remove, listKeys)
- Test listAllUserIds() function with multiple users
- Test getUserMetadata() function returns correct information
- Test AccountSelector component renders accounts correctly
- Test EncryptionFlow routing logic for multiple accounts
- Test useSyncTrigger hook queues operations correctly
- Test MigrationFlow detects and migrates legacy data
- Test ProtectedRoute wrapper enforces authentication

### Property-Based Tests

- Generate random user IDs and verify namespace isolation
- Generate random passphrases and verify key derivation consistency
- Generate random notebook data and verify sync triggers fire correctly
- Generate random account configurations and verify account selector works
- Test that all single-user operations produce identical results to original code

### Integration Tests

- Test full multi-user flow: create User A, sign out, create User B, verify isolation
- Test account switching: sign in as User A, switch to User B, verify correct data loaded
- Test migration flow: create legacy data, enable encryption, verify migration success
- Test sync integration: edit notebook, verify automatic sync trigger, verify cloud upload
- Test routing protection: attempt to access protected route without authentication, verify redirect
- Test guest mode: continue as guest, verify no encryption required, verify limited features

