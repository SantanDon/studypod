# Sign-In/Sign-Out Reinforcement Bugfix Design

## Overview

The authentication system in StudyPodLM has critical inconsistencies stemming from two separate, uncoordinated authentication systems: the legacy email/password system (AuthContext) and the newer encryption PIN/passphrase system (EncryptionStore). Components inconsistently check authentication state using different hooks, causing authenticated users to be incorrectly treated as guests. Additionally, the ProfileMenu displays incorrect status information, AuthPrompt buttons don't navigate properly, and sign-out doesn't fully clear state from both systems.

The fix will unify authentication state checking across all components, ensure proper navigation flows, and implement complete state cleanup on sign-out.

## Glossary

- **Bug_Condition (C)**: The condition where authentication state is inconsistently detected across components, causing authenticated users to see guest-only UI or incorrect profile information
- **Property (P)**: The desired behavior where all components recognize authentication from either system and display correct UI state
- **Preservation**: Existing guest mode functionality, authentication persistence, and data storage that must remain unchanged
- **Legacy Auth System**: The original email/password authentication managed by AuthContext (src/contexts/AuthContext.tsx)
- **Encryption Auth System**: The newer PIN/passphrase authentication managed by EncryptionStore (src/stores/encryptionStore.ts)
- **useAuthState**: A unified hook (src/hooks/useAuthState.ts) that combines both auth systems but is not consistently used
- **usePremiumFeatures**: Hook that determines guest vs authenticated status, currently only checks legacy auth
- **GuestContext**: Context that manages guest limits and shows AuthPrompt dialogs
- **ProfileMenu**: Dropdown menu component showing user info and sign-out option
- **AuthPrompt**: Modal dialog shown when guests hit usage limits

## Bug Details

### Bug Condition

The bug manifests when components check authentication status inconsistently, leading to multiple failure modes. The root cause is that two separate authentication systems exist without proper coordination, and components use different hooks to check auth state.

**Formal Specification:**
```
FUNCTION isBugCondition(componentState)
  INPUT: componentState containing { authCheckMethod, isUnlocked, isAuthenticated }
  OUTPUT: boolean
  
  RETURN (componentState.authCheckMethod == 'useAuth' AND componentState.isUnlocked == true AND componentState.isAuthenticated == false)
         OR (componentState.authCheckMethod == 'usePremiumFeatures' AND componentState.isUnlocked == true)
         OR (componentState.displayedAuthStatus != componentState.actualAuthStatus)
         OR (componentState.navigationButtonClicked AND NOT componentState.navigated)
         OR (componentState.signOutClicked AND (componentState.encryptionStateCleared == false OR componentState.legacyAuthCleared == false))
END FUNCTION
```

### Examples

- **Encryption-only user sees guest limits**: User signs in via encryption system (isUnlocked = true) but usePremiumFeatures only checks isAuthenticated (false), so they see "You've reached your guest limit" dialog
- **ProfileMenu shows "Not signed in"**: User is authenticated but ProfileMenu displays "Not signed in" as the email even though their username appears above it
- **AuthPrompt buttons don't navigate**: User clicks "Sign Up Free" or "Sign In" in AuthPrompt modal but nothing happens - no navigation to /auth page
- **Incomplete sign-out**: User clicks "Sign out" in ProfileMenu, legacy auth clears but encryption state (isUnlocked, masterKey) remains, causing inconsistent state
- **No navigation after sign-out**: User signs out but stays on current page instead of being redirected to /auth page

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Guest mode functionality must continue to work for users who have never signed in
- Guest limit dialogs must continue to appear when true guests reach usage limits
- Successful sign-in must continue to unlock all premium features
- Authentication state must continue to persist across page refreshes
- Authenticated users must continue to maintain their session without re-authentication
- Sign-out must continue to preserve encrypted user data (only clear auth state, not notebooks/sources/messages)

**Scope:**
All inputs that do NOT involve authentication state checking, sign-in/sign-out actions, or navigation from auth-related UI should be completely unaffected by this fix. This includes:
- Creating and editing notebooks, sources, notes
- Chat message functionality
- Podcast generation
- Theme switching and visual effects
- Data export/import functionality
- All other ProfileMenu options besides sign-out

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Inconsistent Auth State Checking**: Components use different hooks to check authentication
   - usePremiumFeatures only checks `useAuth().isAuthenticated` (legacy system)
   - GuestContext checks both systems but components don't use it consistently
   - useAuthState exists but is only used in ProfileMenu, not in usePremiumFeatures or other components

2. **Missing Navigation Handlers**: AuthPrompt buttons have onClick handlers that call navigate() but may not be properly wired
   - handleSignUp calls closeAuthPrompt() then navigate('/auth') but navigation might not execute
   - Similar issue with "Sign In" button in the modal

3. **Incomplete Sign-Out Logic**: ProfileMenu.handleSignOut only clears one auth system
   - Calls clearMasterKey() for encryption system
   - Calls signOut() for legacy system
   - But may not be clearing all state properly or in the right order

4. **Missing Post-SignOut Navigation**: After sign-out completes, navigation to /auth may not execute
   - navigate("/auth", { replace: true }) is called but might not work due to timing or state issues

## Correctness Properties

Property 1: Bug Condition - Unified Authentication Recognition

_For any_ user who is authenticated via either the legacy auth system (isAuthenticated = true) OR the encryption system (isUnlocked = true), all components SHALL recognize them as authenticated and NOT display guest-only UI elements such as guest limit dialogs, guest banners, or "Not signed in" status.

**Validates: Requirements 2.1, 2.2, 2.7**

Property 2: Bug Condition - Navigation from Auth UI

_For any_ user interaction where an authentication-related button is clicked (Sign Up Free, Sign In, Sign Out), the system SHALL navigate to the appropriate page (/auth for sign-in/sign-up, /auth for sign-out) immediately after the action completes.

**Validates: Requirements 2.3, 2.4, 2.6**

Property 3: Bug Condition - Complete State Cleanup on Sign-Out

_For any_ sign-out action, the system SHALL clear ALL authentication state from both the legacy auth system (user, session, isAuthenticated) AND the encryption system (masterKey, isUnlocked, userId), leaving no residual authentication state.

**Validates: Requirements 2.5**

Property 4: Preservation - Guest Mode Functionality

_For any_ user who has never signed in (isAuthenticated = false AND isUnlocked = false), the system SHALL continue to treat them as a guest, display appropriate guest limit dialogs when limits are reached, and show the AuthPrompt with sign-up/sign-in options exactly as before the fix.

**Validates: Requirements 3.1, 3.2**

Property 5: Preservation - Authentication Persistence and Features

_For any_ authenticated user session, the system SHALL continue to persist authentication state across page refreshes, maintain the session without requiring re-authentication, unlock all premium features, and preserve encrypted user data when signing out (only clearing auth state, not user data).

**Validates: Requirements 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/hooks/usePremiumFeatures.ts`

**Function**: `usePremiumFeatures`

**Specific Changes**:
1. **Replace useAuth with useAuthState**: Change from checking only `isAuthenticated` to using the unified `useAuthState` hook
   - Import `useAuthState` instead of `useAuth`
   - Use `isSignedIn` from useAuthState instead of `!isAuthenticated` for guest detection
   - This ensures both auth systems are considered when determining guest status

**File**: `src/components/auth/AuthPrompt.tsx`

**Function**: `handleSignUp` and implicit "Sign In" handler

**Specific Changes**:
2. **Fix Sign Up navigation**: Ensure handleSignUp properly navigates
   - Verify closeAuthPrompt() doesn't interfere with navigation
   - Consider using navigate with replace option or immediate navigation

3. **Add Sign In button handler**: The "Sign In" button in the modal needs an explicit handler
   - Currently only "Sign Up Free" button has handleSignUp
   - Need to add a handleSignIn function that navigates to /auth

**File**: `src/components/profile/ProfileMenu.tsx`

**Function**: `handleSignOut`

**Specific Changes**:
4. **Ensure complete state cleanup**: Verify both auth systems are fully cleared
   - clearMasterKey() clears encryption state
   - signOut() clears legacy auth state
   - Verify queryClient.clear() happens before navigation

5. **Ensure post-signout navigation**: Make sure navigate("/auth") executes after cleanup
   - May need to await signOut() completion
   - May need to use setTimeout or useEffect to ensure navigation happens

**File**: `src/contexts/GuestContext.tsx`

**Function**: GuestProvider initialization

**Specific Changes**:
6. **Use unified auth state**: The GuestContext already checks both systems but could use useAuthState for consistency
   - Currently checks `isAuthenticated || isUnlocked` directly
   - Could use `useAuthState().isSignedIn` for cleaner logic

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate each bug scenario and assert the expected correct behavior. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Encryption-only user guest detection**: Create user with isUnlocked=true, isAuthenticated=false, call usePremiumFeatures(), assert isGuest=false (will fail on unfixed code)
2. **ProfileMenu status display**: Render ProfileMenu with authenticated user, assert "Not signed in" does not appear (will fail on unfixed code)
3. **AuthPrompt Sign Up navigation**: Render AuthPrompt, click "Sign Up Free", assert navigation to /auth occurred (will fail on unfixed code)
4. **AuthPrompt Sign In navigation**: Render AuthPrompt, click "Sign In", assert navigation to /auth occurred (will fail on unfixed code)
5. **Sign-out state cleanup**: Call handleSignOut, assert both clearMasterKey and signOut were called and all state is cleared (may fail on unfixed code)
6. **Sign-out navigation**: Call handleSignOut, assert navigation to /auth occurred (will fail on unfixed code)

**Expected Counterexamples**:
- usePremiumFeatures returns isGuest=true even when isUnlocked=true
- ProfileMenu displays "Not signed in" for authenticated users
- AuthPrompt buttons don't trigger navigation
- Sign-out leaves residual state in one or both auth systems
- Sign-out doesn't navigate to /auth page

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL componentState WHERE isBugCondition(componentState) DO
  result := fixedComponent(componentState)
  ASSERT expectedBehavior(result)
END FOR
```

**Expected Behavior:**
- Encryption-only users are recognized as authenticated (isGuest = false)
- ProfileMenu displays correct user information and status
- AuthPrompt buttons navigate to /auth page
- Sign-out clears all state from both auth systems
- Sign-out navigates to /auth page

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL componentState WHERE NOT isBugCondition(componentState) DO
  ASSERT originalComponent(componentState) = fixedComponent(componentState)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for guest mode, data persistence, and other features, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Guest mode preservation**: Verify true guests (never signed in) continue to see guest limits and AuthPrompt
2. **Authentication persistence preservation**: Verify authenticated users maintain session across page refreshes
3. **Premium features preservation**: Verify authenticated users continue to have unlimited access
4. **Data preservation on sign-out**: Verify sign-out doesn't delete notebooks, sources, messages, or other user data
5. **Non-auth UI preservation**: Verify theme switching, visual effects, data export/import, and other ProfileMenu features continue to work

### Unit Tests

- Test usePremiumFeatures with different auth state combinations (legacy only, encryption only, both, neither)
- Test ProfileMenu rendering with different auth states
- Test AuthPrompt button click handlers and navigation
- Test handleSignOut state cleanup and navigation
- Test useAuthState hook with different combinations of isAuthenticated and isUnlocked

### Property-Based Tests

- Generate random auth state combinations and verify usePremiumFeatures correctly identifies guests vs authenticated users
- Generate random user interactions with AuthPrompt and verify navigation always occurs
- Generate random sign-out scenarios and verify complete state cleanup
- Test that all non-auth features continue to work across many random scenarios

### Integration Tests

- Test full sign-in flow via encryption system, verify no guest limits appear
- Test full sign-in flow via legacy system, verify no guest limits appear
- Test sign-out flow, verify complete cleanup and navigation to /auth
- Test guest user hitting limits, verify AuthPrompt appears with working navigation buttons
- Test authenticated user across page refresh, verify session persists
