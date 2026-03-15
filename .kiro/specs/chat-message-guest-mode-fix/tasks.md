# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Guest Users Cannot View Messages
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: guest user (user=null, guestId present) with valid notebookId
  - Test that useQuery is disabled when user=null and guestId="guest_123" and notebookId is present (from Bug Condition in design)
  - Test that guest messages saved to localStorage don't appear in query results because query is disabled
  - The test assertions should match the Expected Behavior Properties from design: query should be enabled for guests
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: query.enabled=false when it should be true, messages in localStorage but data array is empty
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Authenticated User Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for authenticated users (user.id exists, guestId may or may not exist)
  - Observe: query is enabled when user.id exists and notebookId exists
  - Observe: messages display correctly for authenticated users
  - Observe: query invalidation works when notebook changes
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Test cases: authenticated user query enabled, messages display, query invalidation, no user state (both null)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix for guest user chat messages not displaying

  - [x] 3.1 Implement the fix in useChatMessages.tsx
    - Change line 558 in src/hooks/useChatMessages.tsx
    - Update enabled condition from `enabled: !!notebookId && !!user,` to `enabled: !!notebookId && !!effectiveUserId,`
    - This makes the query enabled for both authenticated users (user?.id) and guest users (guestId)
    - _Bug_Condition: isBugCondition(input) where input.user === null AND input.guestId !== null AND input.notebookId !== null_
    - _Expected_Behavior: Query is enabled when effectiveUserId exists (user?.id || guestId), allowing both user types to fetch messages_
    - _Preservation: Authenticated users (user.id exists) continue to see messages exactly as before, query invalidation and message saving remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Guest Users Can View Messages
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify query is enabled for guest users
    - Verify guest messages display correctly
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Authenticated User Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm authenticated user query behavior unchanged
    - Confirm message display for authenticated users unchanged
    - Confirm query invalidation still works correctly
    - Confirm no user state (both null) still disables query

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
