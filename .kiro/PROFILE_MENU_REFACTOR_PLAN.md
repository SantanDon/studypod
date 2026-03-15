# ProfileMenu Refactor Plan

## Problem Statement
The ProfileMenu is dysfunctional and inconsistent:
1. Shows "Sign in" even when user is signed in
2. Doesn't properly detect authentication state
3. User display shows "Guest" and "Not signed in" for authenticated users
4. Sign out/Sign in navigation is broken

## Root Cause Analysis

### Current Issues
1. **Authentication State Mismatch**: ProfileMenu uses `useAuth()` but the app has TWO authentication systems:
   - Old system: `AuthContext` with email/password (localStorage-based)
   - New system: `EncryptionFlow` with PIN/passphrase (encryption-based)

2. **State Synchronization**: The two systems don't communicate:
   - `AuthContext.user` might be null even when encryption is unlocked
   - `EncryptionStore.isUnlocked` might be true but `AuthContext.user` is null

3. **Guest Mode Confusion**: Guest mode uses `GuestContext` which checks `!isAuthenticated`, but this doesn't account for encryption-based auth

## Solution Architecture

### Phase 1: Understand Current State
- [x] Identify all authentication systems
- [x] Map authentication flow
- [x] Identify state dependencies

### Phase 2: Unified Authentication State
Create a single source of truth for authentication:

```typescript
// New hook: useAuthState.ts
export function useAuthState() {
  const { user, isAuthenticated } = useAuth(); // Old system
  const { isUnlocked, userId } = useEncryptionStore(); // New system
  
  // Unified state
  const isSignedIn = isAuthenticated || isUnlocked;
  const effectiveUser = user || (isUnlocked ? { id: userId, email: null } : null);
  
  return {
    isSignedIn,
    user: effectiveUser,
    isGuest: !isSignedIn,
  };
}
```

### Phase 3: Refactor ProfileMenu
1. Use unified authentication state
2. Show correct button based on state:
   - `isSignedIn === true` → Show "Sign out"
   - `isSignedIn === false` → Show "Sign in"
3. Display correct user info:
   - If `user.email` exists → Show email username
   - If `userId` exists but no email → Show "User" + userId substring
   - If neither → Show "Guest"

### Phase 4: Fix Sign Out Flow
1. Clear ALL authentication state:
   - `clearMasterKey()` (encryption)
   - `signOut()` (old auth)
   - `queryClient.clear()` (cache)
2. Navigate to `/auth`

### Phase 5: Fix Sign In Flow
1. Ensure EncryptionFlow properly sets authentication state
2. Update AuthContext when encryption unlocks
3. Sync user data between systems

## Implementation Tasks

### Task 1: Create Unified Auth Hook
**File**: `src/hooks/useAuthState.ts`
- Create hook that combines AuthContext and EncryptionStore
- Export unified authentication state
- Handle edge cases (both systems active, neither active, etc.)

### Task 2: Update ProfileMenu
**File**: `src/components/profile/ProfileMenu.tsx`
- Replace `useAuth()` with `useAuthState()`
- Fix conditional rendering of Sign in/Sign out
- Fix user display logic
- Add proper state logging

### Task 3: Update GuestContext
**File**: `src/contexts/GuestContext.tsx`
- Use unified auth state instead of just `isAuthenticated`
- Ensure guest mode activates only when truly not signed in

### Task 4: Sync Authentication Systems
**File**: `src/components/encryption/EncryptionFlow.tsx`
- When encryption unlocks, update AuthContext
- Create a "virtual user" in AuthContext for encryption-only auth

### Task 5: Update Sign Out
**File**: `src/components/profile/ProfileMenu.tsx`
- Clear both authentication systems
- Clear all related state
- Proper navigation

## Testing Checklist

### Scenario 1: Guest User
- [ ] ProfileMenu shows "Guest" and "Not signed in"
- [ ] Shows "Sign in" button
- [ ] Clicking "Sign in" goes to `/auth`
- [ ] Guest banner shows with notebook count

### Scenario 2: Signed In (Old System)
- [ ] ProfileMenu shows email username
- [ ] Shows "Sign out" button
- [ ] No guest banner
- [ ] Sign out clears state and goes to `/auth`

### Scenario 3: Signed In (Encryption System)
- [ ] ProfileMenu shows user identifier
- [ ] Shows "Sign out" button
- [ ] No guest banner
- [ ] Sign out clears encryption and goes to `/auth`

### Scenario 4: Sign Out → Sign In
- [ ] After sign out, shows "Sign in" button
- [ ] Clicking "Sign in" goes to `/auth`
- [ ] After sign in, shows "Sign out" button
- [ ] User info displays correctly

### Scenario 5: Page Refresh
- [ ] Authentication state persists
- [ ] ProfileMenu shows correct state
- [ ] No flickering between states

## Success Criteria
1. ProfileMenu always shows correct authentication state
2. "Sign in" appears only when not signed in
3. "Sign out" appears only when signed in
4. User display is accurate and consistent
5. Navigation works correctly in all scenarios
6. No state synchronization issues

## Rollback Plan
If refactor causes issues:
1. Revert to previous ProfileMenu implementation
2. Keep old and new auth systems separate
3. Add feature flag for new authentication system
