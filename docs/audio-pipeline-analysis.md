# StudyPodLM Audio Pipeline — Critical Analysis

> Generated from codebase audit. Covers podcast generation, TTS, voice system, and audiobook conversion.

---

## 1. Pipeline Architecture

```
PodcastView.tsx
  │  handleGenerate()
  ├─► generatePodcastScript()       [podcastGenerator.ts]
  │    → Ollama / Groq AI
  │    → 12,000 char content limit
  │    → Returns {title, segments[{speaker, text}]}
  │
  └─► StreamingTTSGenerator.startStreaming()  [streamingTTSGenerator.ts]
       → Kokoro via Web Worker (ONNX, q8, wasm) ← primary
       → Web Speech API                          ← fallback (no saveable audio)
       → Per-segment generation loop
       → combineAudios() via AudioContext decode/re-encode
       → Auto-save to IndexedDB
```

**Key insight: Entirely client-side.** No backend podcast endpoint exists. The backend (`/backend/src/services/`) only handles chat, immersion, and notebook CRUD — it has no podcast/TTS routes.

### Key Files

| File | Role | Lines |
|------|------|-------|
| `src/lib/podcastGenerator.ts` | AI script generation + parsing + fallback | 749 |
| `src/lib/tts/streamingTTSGenerator.ts` | Hybrid TTS orchestrator (Worker > Web Speech) | 862 |
| `src/lib/tts/ttsWorker.ts` | Web Worker manager for Kokoro TTS | 308 |
| `src/lib/tts/ttsWorkerScript.ts` | Kokoro ONNX inference inside worker | 223 |
| `src/lib/tts/kokoroTTSProvider.ts` | Kokoro provider + voice map | 179 |
| `src/lib/tts/kokoroPremiumTTSProvider.ts` | Premium Kokoro voices (Deep Think mode) | 159 |
| `src/lib/tts/webSpeechProvider.ts` | Web Speech API fallback | 196 |
| `src/lib/tts/podcastAudioGenerator.ts` | Legacy batch audio generator (superseded) | 402 |
| `src/lib/tts/ttsService.ts` | TTS provider interface + config | 65 |
| `src/stores/podcastGenerationStore.ts` | Zustand generation state | 248 |
| `src/components/notebook/PodcastView.tsx` | Main podcast UI orchestrator | 554 |
| `src/components/notebook/TTSProviderSettings.tsx` | Provider + voice settings UI | 413 |
| `src/components/notebook/TTSSettingsDialog.tsx` | Legacy Web Speech voice dialog | 180 |
| `src/components/notebook/AudioPlayer.tsx` | Audio playback component | 233 |
| `src/components/notebook/AudiobookView.tsx` | Audiobook studio UI | 437 |
| `backend/src/routes/audiobook.js` | Server-side audiobook API | 503 |
| `src/components/notebook/StudioSidebar.tsx` | Hosts PodcastView + AudiobookView | ~138 |

---

## 2. 🔴 Critical Bug: Voice Switching Never Works

### Bug #1 — `HOST_VOICE_MAP` overrides user settings

**File:** `src/lib/tts/kokoroTTSProvider.ts` (line ~28) and `src/lib/tts/podcastAudioGenerator.ts` (lines 201-209)

```typescript
// In kokoroTTSProvider.ts — THE SOURCE OF THE BUG:
export const HOST_VOICE_MAP: Record<string, KokoroVoiceId> = {
  'Alex': 'am_michael',    // Hardcoded American Male
  'Sarah': 'af_bella',     // Hardcoded American Female
  'Host 2': 'af_bella',
};

// In podcastAudioGenerator.ts — voice assignment:
const speakerName = segment.speaker as string;
let voice: string;
if (HOST_VOICE_MAP[speakerName]) {        // ← ALWAYS matches 'Alex'/'Sarah'
  voice = HOST_VOICE_MAP[speakerName];     // ← Returns HARDCODED voice, ignores user config
} else if (speakerName === 'Alex') {       // ← NEVER REACHED for 'Alex'
  voice = audioConfig.host1Voice;           // ← User's selection never used!
} else {
  voice = audioConfig.host2Voice;
}
```

**Result:** You can change voices in `TTSProviderSettings` all day — the `HOST_VOICE_MAP` lookup fires first and returns `'am_michael'` / `'af_bella'` every time. **The user's voice config is unreachable code.**

### Bug #2 — `StreamingTTSGenerator` has hardcoded defaults

**File:** `src/lib/tts/streamingTTSGenerator.ts` (line 46)

```typescript
const DEFAULT_CONFIG: StreamingConfig = {
  host1Voice: 'am_michael',    // Hardcoded — ignores user settings
  host2Voice: 'af_bella',      // Hardcoded — ignores user settings
  speed: 1.0,
  useKokoro: true,
  forceWebSpeech: false,
};
```

And `PodcastView.tsx` (line ~279) calls it as:

```typescript
generator.startStreaming(script, { speed: 1.0 }, handleProgress, handleAudioReady);
//                                       ^^^^^^^^^
// Only passes speed — host voices from TTSProviderSettings are NEVER forwarded
```

**Result:** Even if you fix Bug #1, the streaming generator (which is the actual path used by `PodcastView`) has its own hardcoded defaults and never reads from `getPodcastAudioConfig()`.

### Bug #3 — Custom character/name voices don't exist

**File:** `src/lib/podcastGenerator.ts` (line 332)

```typescript
function normalizeSpeaker(speaker: string): "Alex" | "Sarah" {
  const s = String(speaker).toLowerCase().trim();
  if (s.includes("sarah") || s.includes("host 2") || s.includes("host2") || s === "2" || s === "female")
    return "Sarah";
  return "Alex";  // EVERYTHING else becomes "Alex"
}
```

**File:** `src/lib/tts/streamingTTSGenerator.ts` (line 213)

```typescript
const voice = segment.speaker === 'Alex' ? config.host1Voice : config.host2Voice;
//                                                          ^^
// Only two voices exist: anything not "Alex" gets host2Voice
```

**Result:** Custom names like "Dr. Smith" are normalized to "Alex" by the script generator, then the TTS engine has no concept of per-character voice mapping. There is no way to assign different Kokoro voices to different speakers.

---

## 3. Generation Time Analysis

### Typical timing for a "standard" (50-segment) podcast:

| Stage | Bottleneck | Typical Time |
|-------|------------|-------------|
| **AI Script** | Ollama local (Llama 3.1) or Groq cloud (8B). Temp 0.8, JSON output. | 10-60s |
| **Worker init** | Downloads Kokoro-82M ONNX model (~80MB), loads into WASM with q8 quantization | 120s timeout (first load only) |
| **Per-segment TTS** | Each segment runs ONNX inference in Web Worker (~1-3s per segment) | 40-180s |
| **Audio combine** | AudioContext.decodeAudioData() + re-encode for all segments | 2-5s |

**Total:** ~2-4 minutes for standard, ~5-10 minutes for deep-dive.

**First-ever generation adds ~120s** for model download + WASM init (model is cached after that).

### What's slow

1. **Kokoro is running in-browser on CPU via WASM.** No GPU support. Each segment runs full ONNX inference on the main thread's worker pool.
2. **Sequential segment generation.** Segments are processed one-at-a-time. No batching or parallel inference.
3. **No server-side option.** Everything runs in the browser tab. Closing the tab kills generation.
4. **Ollama script generation** (if using local LLM) is slow compared to cloud API.

---

## 4. Provider Architecture Issues

### Three disconnected settings stores

| Store | Key | Used By | Contains |
|-------|-----|---------|----------|
| `TTSConfig` | `tts_provider_config` | `PodcastAudioGenerator` (legacy path) | Provider type, endpoint |
| `PodcastAudioConfig` | `podcast_audio_config` | `TTSProviderSettings` UI | host1Voice, host2Voice, speed |
| `TTSSettings` | `tts_settings` | `useTTS` hook, `TTSSettingsDialog` | Web Speech voices, rate, pitch |

**These are completely independent.** Changing a voice in `TTSSettingsDialog` has zero effect on podcast audio, and vice versa.

### Provider selection from UI has no effect

`TTSProviderSettings.tsx` lets users choose between Kokoro / Ultimate TTS / Web Speech and saves to `TTSConfig`. But `StreamingTTSGenerator` (the actual path used by `PodcastView`) doesn't read `TTSConfig` — it has its own `useKokoro` / `forceWebSpeech` flags that are never set from the UI.

### Ultimate TTS Studio is only accessible via legacy path

The external TTS server (`http://localhost:7860`) can only be used through `PodcastAudioGenerator.generatePodcastAudio()`, which is NOT called by `PodcastView`. The streaming path (`StreamingTTSGenerator`) only supports Kokoro and Web Speech.

### Web Speech produces no saveable audio

When `StreamingTTSGenerator` falls back to Web Speech API, it creates silent placeholder WAV blobs. The user sees a progress bar and gets a "completed" result, but the audio file is silence. No warning is shown.

### No backend generation option

There is no way to offload TTS generation to a server with better hardware. The entire pipeline runs in the browser.

---

## 5. Other Bugs Found

### Bug #4 — `PodcastAudioGenerator.combineAudioBlobs()` produces corrupt WAV

**File:** `src/lib/tts/podcastAudioGenerator.ts` (line 377)

```typescript
private async combineAudioBlobs(blobs: Blob[]): Promise<Blob> {
  const combined = new Blob(blobs, { type: 'audio/wav' });
  return combined;
}
```

Naively concatenates WAV blobs including per-segment headers. The `StreamingTTSGenerator.combineAudios()` path handles this correctly (uses `AudioContext.decodeAudioData()`), but the legacy batch path is broken.

### Bug #5 — Worker initialization race condition

**File:** `src/lib/tts/ttsWorker.ts` (line 82)

If `initialize()` is called concurrently by multiple segments, there's a potential race where two calls could both reach the worker creation code before `initPromise` is assigned. The singleton manager should prevent this, but the guard `isInitializing` only applies within `_doInitialize`.

### Bug #6 — `AudioContentCleaner` referenced by test but doesn't exist

**File:** `src/lib/tts/__tests__/AudioContentCleaner.test.ts` (line 1)

Imports `AudioContentCleaner` from `'../AudioContentCleaner'`, but no such file exists. This test would fail at runtime.

---

## 6. Audiobook Conversion (Existing Feature)

### Backend (`backend/src/routes/audiobook.js` — 503 lines)

A full server-side pipeline already exists:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/audiobook/import-gutenberg` | Import EPUB from Project Gutenberg by book ID |
| `POST /api/audiobook/extract` | Parse uploaded EPUB → extract metadata + chapters |
| `GET /api/audiobook/meta` | Get EPUB metadata |
| `GET /api/audiobook/voices` | List available Kokoro voices on server |
| `GET /api/audiobook/generate/:id` | Generate audio for single chapter (cached WAV) |
| `POST /api/audiobook/generate-full` | Start async full-book generation (returns job ID) |
| `GET /api/audiobook/job-status/:id` | Poll job progress |
| `GET /api/audiobook/download/:filename` | Download completed audiobook |

**Text chunking:** `chunkTextForTTS()` splits into ~400-char chunks at sentence boundaries. Per-chunk audio is generated by server-side Kokoro (q8, CPU), then concatenated by `concatWavFiles()` (strips per-chunk WAV headers, concatenates PCM data, writes new header).

**Cache:** Generated files cached in `uploads/audio_cache/`.

### Frontend (`AudiobookView.tsx` — 437 lines)

Located in `StudioSidebar.tsx` alongside `PodcastView`. Features:
- Gutenberg import (enter book ID → fetches EPUB)
- Voice selection from server Kokoro voices
- Per-chapter generation or full-book generation with job polling
- HTML5 audio player with download

### What's missing for integration

The audiobook backend works independently from the notebook system. It doesn't use the notebook's source content directly — you have to import an EPUB separately. For your Untitled notebook audiobook feature, the integration point would be:
- Hook the existing `POST /api/audiobook/extract` into the notebook source flow
- Or create a new endpoint that takes source documents (PDF, text) and drives them through the same TTS pipeline

---

## 7. Improvement Roadmap

### 🔴 High Priority (Broken — fix first)

| # | Fix | Files to change |
|---|-----|-----------------|
| 1 | Remove `'Alex'`/`'Sarah'` from `HOST_VOICE_MAP` so user voice settings apply | `kokoroTTSProvider.ts`, `podcastAudioGenerator.ts` |
| 2 | Pass `audioConfig.host1Voice`/`host2Voice` from `PodcastView` to `StreamingTTSGenerator` | `PodcastView.tsx`, `streamingTTSGenerator.ts` |
| 3 | Make `StreamingTTSGenerator` read from `getPodcastAudioConfig()` on init | `streamingTTSGenerator.ts` |

### 🟡 Medium Priority (UX)

| # | Fix |
|---|-----|
| 4 | Unify settings stores — one voice config, one UI |
| 5 | Wire UI provider selection into `StreamingTTSGenerator` |
| 6 | Add server-side podcast generation option (GPU-backed, async, ~5-10x faster) |
| 7 | Propagate custom host names through `normalizeSpeaker()` instead of always mapping to "Alex"/"Sarah" |

### 🟢 Low Priority (Nice-to-have)

| # | Fix |
|---|-----|
| 8 | Per-character voice mapping — assign different Kokoro voices to different speakers |
| 9 | Pre-generate on source upload — kick off podcast in background |
| 10 | Stream audio during generation (play completed segments while rest generates) |
| 11 | Fix `PodcastAudioGenerator.combineAudioBlobs()` WAV corruption |
| 12 | Create `AudioContentCleaner.ts` (referenced by test, doesn't exist) |
| 13 | Warn user when falling back to Web Speech (no saveable audio) |

---

## 8. Key Architecture Decisions

- **Kokoro (browser ONNX) as primary** — zero infrastructure, private, free. Trade-off: slow, CPU-only.
- **No backend podcast endpoint** — podcast generation was designed as a purely client-side feature distinct from chat/immersion.
- **Two parallel pipelines** — `StreamingTTSGenerator` (used by `PodcastView`) and `PodcastAudioGenerator` (legacy, used by nothing in the current UI). The streaming version is the active code path.
- **Audiobook is server-side** — built later, uses the same Kokoro engine but on Node.js, with file caching and async job management. Completely separate from the podcast system.
