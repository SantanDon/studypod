# Audio Pipeline Overhaul — Implementation Plan

## How This Plan Is Structured

Each phase has:
- **Files to modify** with exact line-level changes
- **Architecture diagram** showing data flow before/after
- **Testing protocol** with PASS/FAIL criteria (a valid WAV is **not** success)

---

## Phase 0: Testing Infrastructure (Build First)

*Before fixing anything, build the tools that prove fixes work.*

### 0.1 — Backend Audio Validation Utility

**File:** `backend/scripts/validate_audio.js` (new)

A standalone Node script that takes a WAV file path and runs:

```
PASS/FAIL CRITERIA:
┌──────────────────────────────────────────────────────────────┐
│ 1. WAV HEADER VALIDITY                                        │
│    PASS: RIFF header + WAVE format ID present                 │
│    FAIL: Not a WAV file                                       │
│                                                               │
│ 2. FORMAT CORRECTNESS                                         │
│    PASS: 24000Hz sample rate, 1 channel, 16-bit PCM           │
│    FAIL: Wrong sample rate, stereo, or non-PCM format         │
│                                                               │
│ 3. SILENCE DETECTION                                          │
│    PASS: RMS energy > 0.001 (normalized) — actual sound       │
│    FAIL: All samples near zero — silent WAV                   │
│                                                               │
│ 4. DURATION SANITY                                            │
│    PASS: duration within 20%-250% of expected (chars/15)      │
│    FAIL: Too short (< 20%) or too long (> 250%)               │
│                                                               │
│ 5. SPEECH-LIKE FREQUENCY CONTENT                               │
│    PASS: Spectral centroid between 200Hz-4000Hz (speech band) │
│    FAIL: Below 200Hz (hum/bass) or above 4000Hz (noise/whine) │
│                                                               │
│ 6. VOICE DIFFERENTIATION                                      │
│    PASS: Two different voices on same text produce             │
│          measurably different MFCC vectors (DTW distance > 0.1)│
│    FAIL: Voices produce identical or near-identical audio      │
│                                                               │
│ 7. SAMPLE-LEVEL INTEGRITY                                     │
│    PASS: At least 10% of PCM samples have abs value > 100     │
│    FAIL: All samples < 100 (near-silent or corrupt)           │
└──────────────────────────────────────────────────────────────┘
```

**Implementation approach:** Pure Node.js (no external deps) — read WAV header with `fs.read`, parse PCM data, compute RMS/simple spectral features using FFT approximation.

### 0.2 — Frontend Audio Assertion Helper

**File:** `src/lib/tts/__tests__/audioAssertions.ts` (new)

```typescript
export function validateWavBlob(blob: Blob, options: {
  expectedText?: string;
  expectedVoice?: string;
  expectedSampleRate?: number;
}): Promise<ValidationResult>;
```

Uses `Web Audio API` (`AudioContext.decodeAudioData`) to:
- Check sample rate, channel count, bit depth from decoded buffer
- Compute RMS energy
- Estimate duration
- Compare against expected values

### 0.3 — Integration Test Script

**File:** `backend/scripts/test_audio_pipeline.js` (new)

Tests the **full user flow** via API:
1. POST sign in (get cookie)
2. POST pair/initiate → get PIN
3. POST pair/complete → get spm_ key
4. POST notebooks/:id/notes
5. GET notebooks/:id/context
6. Generate podcast audio (test all paths)

Every step validates the response with `validate_audio.js`.

---

## Phase 1: Fix Voice Switching (3 Critical Bugs)

### Bug 1: `HOST_VOICE_MAP` Override

**Data flow (BEFORE):**
```
User settings (host1Voice: 'am_liam')
  → podcastAudioGenerator.ts voice assignment
    → HOST_VOICE_MAP['Alex'] === 'am_michael' ← HARDCODED, wins
    → audioConfig.host1Voice === 'am_liam'     ← NEVER REACHED
```

**Data flow (AFTER):**
```
User settings (host1Voice: 'am_liam')
  → podcastAudioGenerator.ts voice assignment
    → speakerName === 'Alex' → audioConfig.host1Voice === 'am_liam' ✓
```

**File:** `src/lib/tts/podcastAudioGenerator.ts`  
**Change:** Lines 201-209 — remove the `HOST_VOICE_MAP` check, go straight to `host1Voice`/`host2Voice` from config.

```typescript
// BEFORE (broken):
if (HOST_VOICE_MAP[speakerName]) {
  voice = HOST_VOICE_MAP[speakerName];
} else if (speakerName === 'Alex') {
  voice = audioConfig.host1Voice;
} else {
  voice = audioConfig.host2Voice;
}

// AFTER (fixed):
if (speakerName === 'Alex') {
  voice = audioConfig.host1Voice;
} else {
  voice = audioConfig.host2Voice;
}
```

**PASS criteria for Bug 1 fix:**
- Set `host1Voice` to `'am_liam'` in config
- Generate podcast with "Alex" as host1
- Validate output WAV: must be different from default `'am_michael'` voice

### Bug 2: `StreamingTTSGenerator` Hardcoded Defaults

**Data flow (BEFORE):**
```
PodcastView.tsx
  → getStreamingTTSGenerator().startStreaming(script, { speed: 1.0 })
    → DEFAULT_CONFIG = { host1Voice: 'am_michael', host2Voice: 'af_bella', ... }
    → User's voice settings from TTSProviderSettings are NEVER read
```

**Data flow (AFTER):**
```
PodcastView.tsx
  → getPodcastAudioConfig() → reads user's host1Voice/host2Voice
  → getStreamingTTSGenerator().startStreaming(script, { speed, host1Voice, host2Voice })
    → Uses user's voice selections ✓
```

**File:** `src/components/notebook/PodcastView.tsx`  
**Change:** Lines 278-284 — read `getPodcastAudioConfig()` and pass voices into `startStreaming`.

```typescript
import { getPodcastAudioConfig } from '@/lib/tts/podcastAudioGenerator';

// In handleGenerate, replace:
const generator = getStreamingTTSGenerator();
generator.startStreaming(generatedScript, { speed: 1.0 }, handleProgress, handleAudioReady);

// With:
const audioConfig = getPodcastAudioConfig();
const generator = getStreamingTTSGenerator();
generator.startStreaming(
  generatedScript,
  {
    speed: audioConfig.speed,
    host1Voice: audioConfig.host1Voice,
    host2Voice: audioConfig.host2Voice,
  },
  handleProgress,
  handleAudioReady
);
```

**File:** `src/lib/tts/streamingTTSGenerator.ts`  
**Change:** Line 213 — voice assignment already reads `config.host1Voice`/`host2Voice`; no change needed here.

**PASS criteria for Bug 2 fix:**
- Set `host1Voice` to `'bf_alice'` (British female) in TTS settings
- Click Generate Podcast
- Output WAV must sound British female, NOT default 'am_michael'

### Bug 3: Custom Name Normalization

**File:** `src/lib/podcastGenerator.ts`  
**Change:** Line 332 (`normalizeSpeaker`) — preserve the original speaker name when it's a custom value, only normalize standard aliases.

```typescript
// BEFORE:
function normalizeSpeaker(speaker: string): "Alex" | "Sarah" {
  const s = String(speaker).toLowerCase().trim();
  if (s.includes("sarah") || s.includes("host 2") || s.includes("host2") || s === "2" || s === "female")
    return "Sarah";
  return "Alex";  // Everything else → Alex
}

// AFTER:
function normalizeSpeaker(speaker: string, customHost1?: string, customHost2?: string): string {
  const s = String(speaker).toLowerCase().trim();
  if (customHost1 && s === customHost1.toLowerCase()) return customHost1;
  if (customHost2 && s === customHost2.toLowerCase()) return customHost2;
  if (s.includes("sarah") || s.includes("host 2") || s.includes("host2") || s === "2" || s === "female") return "Sarah";
  if (s.includes("alex") || s.includes("host 1") || s.includes("host1") || s === "1" || s === "male") return "Alex";
  return speaker; // Preserve custom names
}
```

**File:** `src/lib/tts/streamingTTSGenerator.ts`  
**Change:** Line 213 — accept a `speakerVoiceMap` in config for per-speaker voice assignment.

```typescript
// Extend StreamingConfig:
interface StreamingConfig {
  host1Voice: string;
  host2Voice: string;
  speakerVoiceMap?: Record<string, string>; // New: custom speaker → voice mapping
  // ...
}

// Voice assignment logic (replaces line 213):
const voice = config.speakerVoiceMap?.[segment.speaker]
  ?? (segment.speaker === 'Alex' ? config.host1Voice : config.host2Voice);
```

**PASS criteria for Bug 3 fix:**
- Set custom host names "Dr. Smith" and "Prof. Jones" in Audio Lab
- Generate podcast
- Script segments must use the custom names (not normalized to Alex/Sarah)
- Optional: if `speakerVoiceMap` is provided, each custom name gets its assigned voice

---

## Phase 2: Provider Architecture Fixes

### 2.1 — Wire UI Provider Selection Into StreamingTTSGenerator

**Current state:** `TTSProviderSettings` saves provider to `TTSConfig`, but `StreamingTTSGenerator` never reads it.

**Fix:** `StreamingTTSGenerator.startStreaming()` reads `TTSConfig` to decide `useKokoro` vs `forceWebSpeech`.

```typescript
import { getTTSConfig } from './ttsService';

// In startStreaming initialization:
const ttsConfig = getTTSConfig();
if (ttsConfig.provider === 'web-speech') {
  config.forceWebSpeech = true;
} else if (ttsConfig.provider === 'ultimate-tts') {
  // Ultimate TTS is only available via PodcastAudioGenerator path
  // For now, fall through to Kokoro (log warning)
  console.warn('Ultimate TTS not supported in streaming path yet, using Kokoro');
}
```

### 2.2 — Unify Settings Stores

**Current state:** 3 independent stores (`TTSConfig`, `PodcastAudioConfig`, `TTSSettings`).

**Fix:** Create a single unified store.

```typescript
// New file: src/stores/audioSettingsStore.ts
interface AudioSettings {
  provider: 'kokoro' | 'ultimate-tts' | 'web-speech';
  host1Voice: string;     // Kokoro voice ID
  host2Voice: string;     // Kokoro voice ID
  speed: number;
  pauseBetweenSegments: number;
  // Web Speech settings (kept for backwards compat)
  webSpeechRate: number;
  webSpeechPitch: number;
}
```

**Migration:** `getPodcastAudioConfig()` → reads from new store. `getTTSConfig()` → reads from new store. Old keys in localStorage are migrated on first access.

---

## Phase 3: Testing Protocol (How We Know It Actually Works)

### 3.1 — WAV is NOT Success

| Test | What it proves | Method |
|------|---------------|--------|
| WAV header valid | File isn't corrupt | Parse RIFF/WAVE headers |
| Has audio content | Isn't silence | RMS > 0.001 |
| Correct duration | Speech was generated for full text | Duration = chars/15 ± 20% |
| Speech-like spectrum | Isn't noise/tone | Spectral centroid 200-4000Hz |
| Voice A ≠ Voice B | Voice switching works | MFCC DTW distance > 0.1 |
| Same voice = consistent | Same voice on same text = similar | MFCC DTW distance < 0.3 |

### 3.2 — Automated Validation Script

**File:** `backend/scripts/validate_audio.js`

```bash
node backend/scripts/validate_audio.js test_audio.wav --voice am_michael --text "Hello world"

# Output:
# ✅ WAV header: valid (RIFF/WAVE, 24000Hz, mono, 16bit)
# ✅ Audio content: RMS=0.234 (not silence)
# ✅ Duration: 1.2s (expected ~0.9s, ratio 1.33x)
# ✅ Speech band: centroid=1850Hz
# ✅ Voice identity: matches am_michael reference (DTW=0.12)
```

### 3.3 — Voice Differentiation Test

Proves that selecting a different voice actually changes the audio:

```bash
# Generate same text with two different voices
node backend/scripts/test_tts.js "Hello world" --voice af_bella --out bella.wav
node backend/scripts/test_tts.js "Hello world" --voice am_michael --out michael.wav

# Compare
node backend/scripts/validate_audio.js --compare bella.wav michael.wav
# PASS: voices differ (DTW distance = 0.87 > 0.1) ✓
```

### 3.4 — Full Pipeline Integration Test

```bash
node backend/scripts/test_audio_pipeline.js

# Stages:
# 1. Auth (sign in or use API key)
# 2. Create notebook with test source
# 3. Generate podcast script
# 4. Generate TTS audio for each segment
# 5. Combine into single WAV
# 6. Validate combined WAV
# 7. Download and save
```

---

## Phase 4: Backend Architecture for Audiobook Integration

### 4.1 — Current Architecture

```
Audiobook pipeline (exists, server-side):
  EPUB → extract chapters → Kokoro TTS per chunk → concat WAVs → cache

Podcast pipeline (client-side only):
  Sources → AI script → Kokoro TTS per segment (browser) → combine → save
```

### 4.2 — Target Architecture

```
Unified audio pipeline:
  Sources → AI script generation
          → [browser Kokoro (default, free, private)]
          → [server Kokoro (async, faster, GPU)]
          → [server ElevenLabs/etc (highest quality, paid)]
          → WAV validation → cache → serve
```

### 4.3 — New Backend Endpoints

| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /api/audio/generate` | Server-side TTS (text, voice → WAV) | High |
| `POST /api/podcast/generate` | Full podcast (sources → script → TTS → WAV) | Medium |
| `GET /api/audio/voices` | List available server-side voices | High |
| `GET /api/audio/provider` | Configure/default provider selection | Low |

### 4.4 — Implementation Order

```
Week 1: Fix bugs + build test infra
  Phase 0: validate_audio.js + test_audio_pipeline.js
  Phase 1: Fix 3 voice bugs

Week 2: Provider unification
  Phase 2: Unified settings store + wire provider selection

Week 3: Server-side audio endpoints
  Phase 4: POST /api/audio/generate endpoint (reuses audiobook Kokoro TTS)

Week 4: End-to-end validation + polish
  Full integration tests pass
  Documentation
```

---

## File Change Summary

| Phase | File | Change Type | Lines Changed |
|-------|------|-------------|---------------|
| 0 | `backend/scripts/validate_audio.js` | **NEW** | ~200 |
| 0 | `backend/scripts/test_audio_pipeline.js` | **NEW** | ~300 |
| 0 | `src/lib/tts/__tests__/audioAssertions.ts` | **NEW** | ~100 |
| 1 | `src/lib/tts/podcastAudioGenerator.ts` | Edit (voice assignment) | 5 |
| 1 | `src/components/notebook/PodcastView.tsx` | Edit (pass config) | 10 |
| 1 | `src/lib/podcastGenerator.ts` | Edit (normalizeSpeaker) | 15 |
| 1 | `src/lib/tts/streamingTTSGenerator.ts` | Edit (speakerVoiceMap) | 10 |
| 2 | `src/stores/audioSettingsStore.ts` | **NEW** | ~80 |
| 2 | `src/lib/tts/ttsService.ts` | Edit (migrate to new store) | 15 |
| 2 | `src/lib/tts/podcastAudioGenerator.ts` | Edit (use new store) | 5 |
| 2 | `src/components/notebook/TTSProviderSettings.tsx` | Edit (use new store) | 10 |
| 3 | `backend/src/routes/audio.js` | **NEW** | ~150 |
| 4 | `backend/src/server.js` | Edit (register audio route) | 2 |

---

## Testing Hierarchy

```
Test                                    Running where?       What it proves
─────────────────────────────────────────────────────────────────────────────
validate_audio.js --file test.wav       CLI / CI             WAV has real audio
validate_audio.js --compare a.wav b.wav CLI / CI             Voice switching works
npm test (unit tests)                   CI / pre-commit      No regressions
test_audio_pipeline.js                  CLI / CI             Full user flow works
Manual: listen to output                Human                It sounds right

The hierarchy means:
  ❌ validate_audio.js fails → don't even listen to it (scientifically broken)
  ✅ validate_audio.js passes → might still sound bad (human judgment)
  Both needed for "it actually works"
```

---

## Key Risks

1. **Kokoro model loading** — 120s timeout, ~80MB download. First-run tests will be slow. Mitigation: cache model in CI.
2. **Browser vs Node Kokoro** — client uses `q8`/`wasm`, server uses `q8`/`cpu`. Slightly different outputs. Mitigation: validate separately per environment.
3. **MFCC comparison** — complex algorithm. Mitigation: start simple (RMS profile correlation), only add MFCC if needed.
4. **Web Speech can't produce saveable audio** — fundamental limitation. Mitigation: always test with Kokoro path first, mark Web Speech results as degraded.
