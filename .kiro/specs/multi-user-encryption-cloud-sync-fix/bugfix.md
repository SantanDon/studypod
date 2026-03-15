# Bugfix Requirements Document: Multi-User Encryption and Cloud Sync Integration

## Introduction

The encryption system in StudyPodLM does not properly support multiple user accounts on the same device. When a user creates an encrypted account and then attempts to sign in as a guest or create a new account, they are incorrectly logged into the previous encrypted account's data instead of creating a new isolated session. This occurs because the encryption system uses shared localStorage keys without user-specific namespacing, causing all users on the same device to access the same encrypted data.

Additionally, the cloud sync integration is 90% complete but lacks critical routing, sync triggers, and data migration components needed to make it functional for end users.

This bug affects the core privacy and multi-user functionality of the application, preventing proper user isolation and making the cloud sync feature unusable in its current state.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user creates an encrypted account with a passphrase THEN the system stores `encryption_salt`, `userId`, and `recovery_key_hash` in localStorage without user-specific namespacing

1.2 WHEN a second user attempts to sign in as guest or create a new account on the same device THEN the system detects the existing `encryption_salt` in localStorage and shows the authentication screen instead of account creation

1.3 WHEN the second user enters any passphrase THEN the system derives a key using the first user's salt, resulting in either authentication failure or incorrect access to the first user's encrypted data

1.4 WHEN two users have the same passphrase THEN the second user can decrypt and access the first user's data, violating user isolation

1.5 WHEN a user signs out and another user signs in THEN the encryption store clears the in-memory key but localStorage still contains the previous user's salt and recovery data

1.6 WHEN the EncryptionFlow component checks for existing setup THEN it only checks for the presence of `encryption_salt` without verifying which user it belongs to

1.7 WHEN the Authentication component retrieves the salt THEN it uses `localStorage.getItem('encryption_salt')` without any user context

1.8 WHEN the AccountCreation component stores user data THEN it stores `userId` separately but uses non-namespaced keys for `saltBase64` and recovery data

1.9 WHEN cloud sync attempts to upload data THEN the sync manager has no mechanism to associate encrypted data with specific user accounts

1.10 WHEN the application routes are configured THEN there is no EncryptionFlow component in the routing structure to enforce authentication

1.11 WHEN data mutations occur (notebook edits, source additions) THEN there are no sync triggers to queue the changes for cloud upload

1.12 WHEN an existing user with local data enables encryption THEN there is no migration flow to encrypt and sync their existing localStorage data

### Expected Behavior (Correct)

2.1 WHEN a user creates an encrypted account THEN the system SHALL store all encryption-related data (salt, recovery key hash, encrypted test value) in user-namespaced localStorage keys using the format `user:{userId}:encryption_salt`

2.2 WHEN a second user attempts to sign in as guest or create a new account THEN the system SHALL recognize this as a new user session and show the appropriate flow (guest mode or new account creation) without accessing the first user's data

2.3 WHEN a user enters their passphrase THEN the system SHALL derive the encryption key using only their own salt and SHALL only decrypt their own data

2.4 WHEN two users have the same passphrase THEN the system SHALL maintain complete data isolation because each user has a unique salt and userId

2.5 WHEN a user signs out THEN the system SHALL clear the in-memory encryption key and SHALL track which user was signed in to prevent cross-user data access

2.6 WHEN the EncryptionFlow component checks for existing setup THEN it SHALL check for user-specific encryption data and SHALL provide options to switch between users or create a new account

2.7 WHEN the Authentication component retrieves the salt THEN it SHALL use the current user's namespaced localStorage key `user:{userId}:encryption_salt`

2.8 WHEN the AccountCreation component stores user data THEN it SHALL use consistent user-namespaced keys for all encryption-related data

2.9 WHEN cloud sync uploads data THEN the sync manager SHALL include the userId in the encrypted entity metadata to enable proper user isolation on the server

2.10 WHEN the application initializes THEN the EncryptionFlow component SHALL be integrated into the routing structure to enforce authentication before accessing protected routes

2.11 WHEN data mutations occur THEN the application SHALL trigger sync operations via the useSyncManager hook to queue changes for cloud upload

2.12 WHEN an existing user enables encryption for the first time THEN the system SHALL provide a migration flow that encrypts their existing localStorage data and queues it for sync

2.13 WHEN a user wants to identify which notes belong to which account THEN the system SHALL provide a UI component that lists all stored user accounts and allows testing passphrases to identify the correct account

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a single user creates an account and uses the application THEN the system SHALL CONTINUE TO encrypt and decrypt their data correctly using AES-256-GCM

3.2 WHEN a user enters the correct passphrase THEN the system SHALL CONTINUE TO derive the correct encryption key using PBKDF2-SHA256 with 100,000 iterations

3.3 WHEN a user generates a recovery key THEN the system SHALL CONTINUE TO create a 64-character hex key and store only the hashed version

3.4 WHEN encrypted data is synced to the cloud THEN the system SHALL CONTINUE TO use the existing CloudClient API endpoints without modification

3.5 WHEN the sync queue processes operations THEN the system SHALL CONTINUE TO use exponential backoff retry logic for failed operations

3.6 WHEN a user exports their data THEN the system SHALL CONTINUE TO provide encrypted and plaintext export options

3.7 WHEN the application is offline THEN the system SHALL CONTINUE TO queue sync operations for later processing

3.8 WHEN a user's data is decrypted THEN the system SHALL CONTINUE TO verify checksums to ensure data integrity

3.9 WHEN the encryption store manages keys THEN the system SHALL CONTINUE TO keep keys in memory only and never persist them to localStorage

3.10 WHEN a user signs out THEN the system SHALL CONTINUE TO clear all in-memory encryption keys from the encryptionStore
