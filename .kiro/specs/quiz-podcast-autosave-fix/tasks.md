# Implementation Plan

- [x] 1. Fix JSON Parser Brace Normalization

  - [x] 1.1 Add normalizeBraces function to jsonParser.ts


    - Create function that replaces `{{` with `{` and `}}` with `}`
    - Add console.log for debugging when normalization occurs

    - _Requirements: 1.1, 1.2, 1.4_
  - [x] 1.2 Integrate normalizeBraces into cleanJsonResponse

    - Call normalizeBraces as first step in cleanJsonResponse


    - Ensure existing parsing logic works with normalized input
    - _Requirements: 1.3, 3.2, 3.3_
  - [x] 1.3 Write property test for brace normalization

    - **Property 1: Brace Normalization Preserves JSON Structure**

    - **Validates: Requirements 1.1, 1.2, 3.2, 3.3**

  - [x] 1.4 Write property test for quiz JSON round-trip

    - **Property 2: Quiz JSON Round-Trip**
    - **Validates: Requirements 1.3**

- [x] 2. Checkpoint - Verify JSON parsing fix

  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Fix Podcast Auto-Save

  - [x] 3.1 Review and fix handleAudioReady callback in PodcastView.tsx



    - Ensure savePodcast is called when combineAudios resolves
    - Capture script reference correctly to avoid stale closure
    - Add proper error handling for save failures

    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 3.2 Add blob size validation before auto-save

    - Skip save if blob.size < 1000 bytes
    - Log skip reason for debugging
    - _Requirements: 2.5_
  - [x] 3.3 Write property test for blob size guard

    - **Property 3: Small Blob Skip**
    - **Validates: Requirements 2.5**

- [x] 4. Final Checkpoint - Verify all fixes


  - Ensure all tests pass, ask the user if questions arise.
