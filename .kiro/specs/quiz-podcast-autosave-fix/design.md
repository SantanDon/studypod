# Design Document: Quiz and Podcast Auto-Save Fix

## Overview

This design addresses two bugs in the notebook application:
1. Quiz generation fails when the LLM returns JSON with double curly braces (`{{` and `}}`) instead of single braces
2. Podcast audio does not reliably auto-save to history after generation completes

The root causes are:
- The JSON parser doesn't handle the common LLM behavior of escaping braces by doubling them
- The podcast auto-save callback may not fire due to timing issues with the async audio combination flow

## Architecture

The fix involves two isolated changes:

```
┌─────────────────────────────────────────────────────────────┐
│                    JSON Parser Module                        │
│  src/utils/jsonParser.ts                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  cleanJsonResponse()                                 │   │
│  │  - NEW: normalizeBraces() - converts {{ to {        │   │
│  │  - Existing: extract JSON from markdown             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Podcast View Component                      │
│  src/components/notebook/PodcastView.tsx                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  handleAudioReady()                                  │   │
│  │  - FIX: Ensure savePodcast is called reliably       │   │
│  │  - FIX: Handle async timing correctly               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. JSON Parser Enhancement

**File:** `src/utils/jsonParser.ts`

**New Function:**
```typescript
/**
 * Normalize double curly braces to single braces
 * LLMs sometimes output {{ and }} instead of { and }
 */
function normalizeBraces(text: string): string
```

**Modified Function:**
```typescript
function cleanJsonResponse(response: string): string {
  // Add brace normalization as first step
  let cleaned = normalizeBraces(response.trim());
  // ... existing logic
}
```

### 2. Podcast Auto-Save Fix

**File:** `src/components/notebook/PodcastView.tsx`

**Issue:** The `handleAudioReady` callback checks `!generator.isRunning()` but this may be a race condition. The callback should trigger save regardless of generator state when it receives valid audio.

**Fix:** Move the auto-save logic to execute when `combineAudios()` resolves successfully, ensuring the script reference is captured correctly.

## Data Models

No changes to data models required. The existing structures are sufficient:

```typescript
// Quiz structure (unchanged)
interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  // ...
}

// Podcast save parameters (unchanged)
interface SavePodcastParams {
  title: string;
  blob: Blob;
  duration?: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Brace Normalization Preserves JSON Structure

*For any* valid JSON string where all `{` are replaced with `{{` and all `}` are replaced with `}}`, normalizing the braces and then parsing SHALL produce the same object as parsing the original JSON.

**Validates: Requirements 1.1, 1.2, 3.2, 3.3**

### Property 2: Quiz JSON Round-Trip

*For any* valid quiz response object, if we serialize it to JSON, double all braces, then pass it through the parser, we SHALL get back an equivalent quiz object.

**Validates: Requirements 1.3**

### Property 3: Small Blob Skip

*For any* audio blob with size less than 1000 bytes, the auto-save function SHALL not be called.

**Validates: Requirements 2.5**

## Error Handling

### JSON Parsing Errors

1. If brace normalization produces invalid JSON, fall back to existing line-by-line parsing
2. Log the original response and normalized response for debugging
3. Return null and let the caller handle the error gracefully

### Auto-Save Errors

1. Wrap save operation in try-catch
2. Display user-friendly error toast on failure
3. Log detailed error for debugging
4. Do not block the user from using the generated podcast

## Testing Strategy

### Unit Tests

- Test `normalizeBraces()` with various input patterns
- Test `cleanJsonResponse()` with double-braced JSON
- Test auto-save trigger conditions

### Property-Based Tests

Using `fast-check` for property-based testing:

1. **Brace Normalization Property**: Generate random valid JSON, double all braces, normalize, parse, and verify equivalence
2. **Quiz Round-Trip Property**: Generate random quiz objects, serialize with doubled braces, parse, verify equivalence
3. **Blob Size Guard Property**: Generate blobs of various sizes, verify save behavior

### Integration Tests

- End-to-end quiz generation with mocked LLM returning double-braced JSON
- Podcast generation flow with auto-save verification
