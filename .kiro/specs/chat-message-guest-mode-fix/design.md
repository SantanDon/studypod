# Chat Message Guest Mode Fix - Bugfix Design

## Overview

This bugfix addresses a React Query configuration issue where guest users' chat messages disappear after sending. The root cause is that the `useQuery` hook in `useChatMessages.tsx` has an `enabled` condition that only checks for `!!user`, but guest users don't have a `user` object - they only have a `guestId`. The hook already computes `effectiveUserId = user?.id || guestId` for other operations, but the query remains disabled for guests, preventing their messages from being fetched and displayed.

The fix is minimal: change the `enabled` condition from `!!notebookId && !!user` to `!!notebookId && !!effectiveUserId`. This ensures both authenticated users and guest users can see their chat messages.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when a guest user (guestId exists, user.id does not) attempts to view chat messages
- **Property (P)**: The desired behavior - chat messages should be fetched and displayed for both authenticated and guest users
- **Preservation**: Existing behavior for authenticated users and the message saving/invalidation logic must remain unchanged
- **effectiveUserId**: The computed value `user?.id || guestId` that represents the current user regardless of authentication method
- **React Query enabled**: The condition that determines whether a query should run or remain disabled
- **guestId**: A unique identifier generated for unauthenticated users (format: `guest_${timestamp}_${random}`)

## Bug Details

### Bug Condition

The bug manifests when a guest user sends a chat message. The message is successfully saved to localStorage via `localStorageService.saveChatMessage()`, but the React Query that fetches messages remains disabled because it checks `!!user` instead of `!!effectiveUserId`. This causes the UI to show a loading state briefly, then display no messages.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { user: User | null, guestId: string | null, notebookId: string }
  OUTPUT: boolean
  
  RETURN input.user === null
         AND input.guestId !== null
         AND input.notebookId !== null
         AND userAttemptingToViewMessages(input)
END FUNCTION
```

### Examples

- **Guest sends first message**: User with `guestId="guest_1234_abc"` and `user=null` sends "What is photosynthesis?" → Message saves to localStorage but query is disabled → Message disappears from UI
- **Guest sends follow-up message**: Same guest sends another message → Both messages are in localStorage but neither displays because query remains disabled
- **Guest switches notebooks**: Guest navigates to different notebook → Query is disabled for that notebook too, no messages display
- **Edge case - No user or guest**: User with `user=null` and `guestId=null` → Query correctly stays disabled (expected behavior)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Authenticated users (with `user.id`) must continue to see their messages exactly as before
- Message saving to localStorage must remain unchanged in format and structure
- Query invalidation when notebook changes must continue to work
- The `useEffect` that invalidates queries based on `effectiveUserId` must continue to function
- All other React Query options (`refetchOnMount`, `refetchOnReconnect`) must remain unchanged

**Scope:**
All inputs where `user.id` exists should be completely unaffected by this fix. This includes:
- Authenticated users viewing their messages
- Authenticated users sending new messages
- Authenticated users switching between notebooks
- The mutation logic in `sendMessage` which already uses `effectiveUserId` correctly

## Hypothesized Root Cause

Based on the code analysis, the root cause is clear:

1. **Inconsistent User Check**: The `enabled` condition uses `!!user` while the rest of the hook uses `effectiveUserId = user?.id || guestId`
   - Line 495: `const effectiveUserId = user?.id || guestId;` correctly computes the effective user
   - Line 558: `enabled: !!notebookId && !!user,` incorrectly only checks for `user`
   - Line 568: `if (!notebookId || !effectiveUserId) return;` correctly uses `effectiveUserId` in the useEffect

2. **Copy-Paste from useNotes**: The same pattern exists in `useNotes.tsx` (line 37), suggesting this was copied without considering guest mode

3. **Working Mutation Logic**: The `sendMessage` mutation correctly checks `effectiveUserId` (line 582), which is why messages save successfully but don't display

4. **No DOM or Timing Issues**: This is purely a React Query configuration issue, not a DOM selection or timing problem

## Correctness Properties

Property 1: Bug Condition - Guest Users Can View Messages

_For any_ user state where `guestId` exists and `user` is null, and a valid `notebookId` is provided, the fixed `useQuery` hook SHALL enable the query and fetch messages from localStorage, allowing guest users to see their chat history.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Authenticated User Behavior

_For any_ user state where `user.id` exists, the fixed `useQuery` hook SHALL produce exactly the same behavior as the original code, preserving all existing functionality for authenticated users including message fetching, display, and query invalidation.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**File**: `src/hooks/useChatMessages.tsx`

**Function**: `useChatMessages` (line 492)

**Specific Changes**:
1. **Update enabled condition**: Change line 558 from:
   ```typescript
   enabled: !!notebookId && !!user,
   ```
   to:
   ```typescript
   enabled: !!notebookId && !!effectiveUserId,
   ```

This single-line change ensures the query runs for both authenticated users (`user?.id` is truthy) and guest users (`guestId` is truthy), while remaining disabled when neither exists.

**Why This Works**:
- `effectiveUserId` is already computed on line 495 as `user?.id || guestId`
- The `useEffect` on line 568 already uses `effectiveUserId` for invalidation
- The `sendMessage` mutation on line 582 already uses `effectiveUserId` for authentication checks
- This makes the query's enabled condition consistent with the rest of the hook

**Optional Consideration**: The same issue exists in `src/hooks/useNotes.tsx` line 37, but that's outside the scope of this bugfix. It should be addressed separately if guest users need to view notes.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that guest users cannot see messages with the current code.

**Test Plan**: Write tests that simulate guest user scenarios and observe that the query is disabled. Run these tests on the UNFIXED code to confirm the bug exists.

**Test Cases**:
1. **Guest User Query Disabled**: Mock `user=null` and `guestId="guest_123"` → Assert query is disabled (will pass on unfixed code, confirming bug)
2. **Guest Message Not Displayed**: Guest sends message → Assert message is in localStorage but not in query results (will pass on unfixed code)
3. **Guest Switches Notebooks**: Guest navigates to new notebook → Assert query remains disabled (will pass on unfixed code)
4. **No User or Guest**: Mock `user=null` and `guestId=null` → Assert query is disabled (should pass on both unfixed and fixed code)

**Expected Counterexamples**:
- Query's `enabled` property evaluates to `false` when `user=null` and `guestId="guest_123"`
- Messages exist in localStorage but `data` array is empty because query never runs
- Console logs show "Refreshing messages" from useEffect but query doesn't actually fetch

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := useQuery_fixed(input)
  ASSERT result.enabled === true
  ASSERT result.data.length > 0 (if messages exist in localStorage)
END FOR
```

**Test Cases**:
1. **Guest Query Enabled**: Mock `user=null` and `guestId="guest_123"` → Assert query is enabled
2. **Guest Messages Displayed**: Guest sends message → Assert message appears in query results
3. **Guest Multiple Messages**: Guest sends 3 messages → Assert all 3 messages display correctly
4. **Guest Notebook Switch**: Guest switches notebooks → Assert query refetches for new notebook

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT useQuery_original(input).enabled = useQuery_fixed(input).enabled
  ASSERT useQuery_original(input).data = useQuery_fixed(input).data
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all authenticated user scenarios

**Test Plan**: Observe behavior on UNFIXED code first for authenticated users, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Authenticated User Query**: Mock `user={id: "user_123"}` → Observe query is enabled on unfixed code → Assert same behavior after fix
2. **Authenticated Message Display**: Authenticated user sends message → Observe message displays on unfixed code → Assert same behavior after fix
3. **Query Invalidation**: Authenticated user switches notebooks → Observe query invalidates on unfixed code → Assert same behavior after fix
4. **No User State**: Mock `user=null` and `guestId=null` → Observe query is disabled on unfixed code → Assert same behavior after fix

### Unit Tests

- Test that `enabled` evaluates correctly for guest users (`user=null`, `guestId` present)
- Test that `enabled` evaluates correctly for authenticated users (`user.id` present)
- Test that `enabled` evaluates correctly for no user (`user=null`, `guestId=null`)
- Test that messages are fetched when query is enabled for guests
- Test that query invalidation works for both user types

### Property-Based Tests

- Generate random user states (authenticated, guest, none) and verify query enabled state matches `!!notebookId && !!effectiveUserId`
- Generate random message sets and verify they display correctly for both user types
- Generate random notebook switches and verify query invalidation works consistently

### Integration Tests

- Test full guest user flow: open app → create notebook → send message → verify message displays
- Test authenticated user flow remains unchanged: login → send message → verify message displays
- Test switching between notebooks for both user types
- Test that localStorage persistence works correctly for both user types
