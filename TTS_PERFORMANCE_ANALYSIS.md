# TTS Performance Analysis: Page Unresponsiveness Issue

## Executive Summary

StudyLM's podcast generation feature was causing "Page Unresponsive" browser dialogs during audio generation. This document details the root cause, attempted solutions, and the final resolution.

---

## The Problem

When users clicked "Generate Podcast", the browser would freeze for several seconds at a time, triggering Chrome's "Page Unresponsive" dialog. Users could not:
- Use the chat feature
- Navigate the UI

- Click buttons or scroll
- Switch tabs within the notebook

The freeze occurred repeatedly throughout the generation process (once per audio segment, ~30-50 times for a full podcast).

---

## Root Cause Analysis

### The Culprit: Kokoro TTS + ONNX Runtime

Kokoro TTS is a high-quality text-to-speech library that runs entirely in the browser using ONNX (Open Neural Network Exchange) runtime. While this provides excellent voice quality without requiring a server, it has a critical limitation:

**ONNX inference runs on the main JavaScript thread.**

```typescript
// From kokoroTTSProvider.ts - The blocking call
const audio = await kokoro.generate(text, {
  voice: voice as KokoroVoiceId,
  speed,
});
```

When `kokoro.generate()` is called:
1. The ONNX runtime loads the neural network model (~20MB)
2. It performs matrix multiplications and tensor operations
3. These operations are CPU-intensive and take 2-5 seconds per segment
4. **During this time, the main thread is completely blocked**

### Why JavaScript's Single-Threaded Nature Matters

JavaScript runs on a single thread (the "main thread"). This thread handles:
- User interactions (clicks, scrolls, typing)
- DOM updates (rendering UI changes)
- Network requests
- Timer callbacks
- **All synchronous code execution**

When ONNX performs inference, it monopolizes this thread:

```
Timeline during Kokoro TTS generation:
├── User clicks "Generate"
├── Segment 1: ONNX inference (3 seconds) ← BLOCKED
│   └── User tries to click chat → No response
├── Small yield (50ms)
├── Segment 2: ONNX inference (3 seconds) ← BLOCKED
│   └── User tries to scroll → No response
├── Small yield (50ms)
├── ... (repeat 30-50 times)
└── Complete
```

---

## Attempted Solutions (That Didn't Work)

### Attempt 1: Aggressive Yielding with setTimeout/requestAnimationFrame

```typescript
// streamingTTSGenerator.ts - First attempt
private longYield(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, Math.max(0, ms - 16));
      });
    }, 0);
  });
}

// Usage between segments
await this.longYield(100); // Yield for 100ms
const response = await this.kokoroProvider.synthesize({...}); // Still blocks for 3+ seconds
await this.longYield(100);
```

**Why it failed:** The yield only helps BETWEEN segments. Once `synthesize()` is called, the thread is blocked until ONNX completes. A 100ms yield doesn't help when the next operation blocks for 3000ms.

### Attempt 2: requestIdleCallback

```typescript
// streamingTTSGenerator.ts - Second attempt
private backgroundYield(ms: number): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        setTimeout(resolve, ms);
      }, { timeout: ms + 100 });
    } else {
      setTimeout(resolve, ms);
    }
  });
}
```

**Why it failed:** `requestIdleCallback` schedules work during browser idle time, but ONNX inference isn't "scheduled work" - it's a synchronous blocking operation that ignores the event loop entirely.

### Attempt 3: Longer Yield Durations (200-500ms)

```typescript
const DEFAULT_CONFIG: StreamingConfig = {
  yieldDuration: 500, // Increased from 50ms to 500ms
};
```

**Why it failed:** This just added more delay between segments without addressing the core issue. Users still experienced 3-second freezes, just with longer gaps between them.

### Attempt 4: Throttled Progress Updates

```typescript
private throttledProgress(onProgress: ProgressCallback, progress: StreamingProgress): void {
  const now = Date.now();
  if (now - this.lastProgressUpdate >= 500) { // Only update every 500ms
    this.lastProgressUpdate = now;
    onProgress(progress);
  }
}
```

**Why it failed:** Reducing React re-renders helped slightly, but the main issue was ONNX blocking, not React rendering.

---

## Why Web Workers Don't Solve This

The obvious solution would be to move ONNX inference to a Web Worker:

```typescript
// Hypothetical worker solution
const worker = new Worker('tts-worker.js');
worker.postMessage({ text: 'Hello world', voice: 'am_michael' });
worker.onmessage = (e) => {
  const audioBlob = e.data;
  // Use the audio
};
```

**Why this doesn't work with Kokoro/ONNX:**

1. **WebAssembly SharedArrayBuffer Requirements**
   - ONNX runtime uses WebAssembly with threading
   - This requires `SharedArrayBuffer` which needs specific CORS headers
   - Many hosting environments don't support this

2. **Model Loading in Workers**
   - The 20MB+ model would need to be loaded in the worker
   - Workers have limited access to the main thread's resources
   - Kokoro's initialization assumes main thread context

3. **Audio Context Limitations**
   - Web Audio API (`AudioContext`) must be created on the main thread
   - Workers can't directly create or manipulate audio

4. **Library Design**
   - Kokoro-js wasn't designed for Web Worker usage
   - It uses browser APIs that aren't available in workers

---

## The Solution: Web Speech API

### Why Web Speech API Works

The Web Speech API is a browser-native feature that:
- Runs in a **separate browser process** (not the main JS thread)
- Is completely **non-blocking**
- Requires **no model loading** (uses system voices)
- Works **instantly** with no setup

```typescript
// Web Speech API - Non-blocking
const utterance = new SpeechSynthesisUtterance(text);
utterance.voice = selectedVoice;
utterance.rate = 1.0;
utterance.onend = () => console.log('Done speaking');
speechSynthesis.speak(utterance); // Returns immediately!
```

### Implementation

```typescript
// streamingTTSGenerator.ts - Final solution
class StreamingTTSGenerator {
  /**
   * Play a specific segment using Web Speech API
   */
  playSegment(index: number, onEnd?: () => void): void {
    const segment = this.generatedAudios[index];
    if (!segment || typeof speechSynthesis === 'undefined') return;

    // Cancel any ongoing speech
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(segment.text);
    
    // Get voices
    const voices = speechSynthesis.getVoices();
    
    // Select appropriate voice based on speaker
    if (segment.speaker === 'Alex') {
      const maleVoice = voices.find(v => 
        v.name.includes('Male') || 
        v.name.includes('David') || 
        v.name.includes('Mark')
      );
      if (maleVoice) utterance.voice = maleVoice;
      utterance.pitch = 1.0;
    } else {
      const femaleVoice = voices.find(v => 
        v.name.includes('Female') || 
        v.name.includes('Zira') || 
        v.name.includes('Samantha')
      );
      if (femaleVoice) utterance.voice = femaleVoice;
      utterance.pitch = 1.1;
    }

    utterance.rate = 1.0;
    utterance.onend = () => onEnd?.();
    
    speechSynthesis.speak(utterance); // Non-blocking!
  }

  /**
   * Play all segments sequentially
   */
  playAll(startIndex: number = 0, onSegmentChange?: (index: number) => void, onComplete?: () => void): void {
    if (startIndex >= this.generatedAudios.length) {
      onComplete?.();
      return;
    }

    onSegmentChange?.(startIndex);
    
    this.playSegment(startIndex, () => {
      // Small pause between segments
      setTimeout(() => {
        this.playAll(startIndex + 1, onSegmentChange, onComplete);
      }, 300);
    });
  }
}
```

### Generation Flow (New)

```typescript
// Generation is now instant - just prepares the script
private async generateWithWebSpeech(
  script: PodcastScript,
  config: StreamingConfig,
  onProgress: ProgressCallback,
  onAudioReady: AudioReadyCallback
): Promise<void> {
  // Process segments quickly (no actual audio generation)
  for (let i = 0; i < optimizedSegments.length; i++) {
    const segment = optimizedSegments[i];
    
    // Just store the text - no heavy processing
    this.generatedAudios.push({
      url: URL.createObjectURL(new Blob([JSON.stringify(segment)])),
      duration: this.estimateDuration(segment.text),
      speaker: segment.speaker,
      text: segment.text,
    });

    // Update progress
    onProgress({
      phase: 'generating',
      currentSegment: i + 1,
      totalSegments: optimizedSegments.length,
      percentage: Math.round(10 + ((i + 1) / optimizedSegments.length) * 85),
      message: `Prepared ${segment.speaker}'s line`,
      canPlay: true,
    });

    // Tiny yield - just for UI updates
    await new Promise(r => setTimeout(r, 20));
  }

  // Complete instantly!
  onProgress({
    phase: 'complete',
    currentSegment: optimizedSegments.length,
    totalSegments: optimizedSegments.length,
    percentage: 100,
    message: 'Podcast ready!',
    canPlay: true,
  });
}
```

---

## Trade-offs

| Aspect | Kokoro TTS | Web Speech API |
|--------|-----------|----------------|
| Voice Quality | High (neural network) | Medium (system voices) |
| Responsiveness | Poor (blocks main thread) | Excellent (non-blocking) |
| Setup Required | None (runs in browser) | None (built into browser) |
| Voice Variety | 20+ high-quality voices | Depends on OS/browser |
| Offline Support | Yes (after model loads) | Depends on OS |
| File Generation | Yes (creates audio files) | No (real-time only) |

---

## IMPLEMENTED SOLUTION: Web Worker with Kokoro TTS

### December 2025 Update

Research revealed that Kokoro TTS now supports Web Workers with WebGPU acceleration. This provides the best of both worlds:
- **High-quality neural TTS** (Kokoro)
- **Non-blocking UI** (Web Worker)
- **GPU acceleration** (WebGPU when available)

### Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Thread (UI)                        │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │  PodcastView    │───▶│  StreamingTTSGenerator      │    │
│  │  (React UI)     │    │  (Orchestrator)             │    │
│  └─────────────────┘    └──────────────┬──────────────┘    │
│                                        │                    │
│                         postMessage()  │  onmessage()       │
│                                        ▼                    │
├────────────────────────────────────────┼────────────────────┤
│                     Web Worker Thread  │                    │
│                         ┌──────────────▼──────────────┐    │
│                         │  ttsWorkerScript.ts         │    │
│                         │  ┌────────────────────────┐ │    │
│                         │  │  Kokoro TTS + ONNX     │ │    │
│                         │  │  (Heavy computation)   │ │    │
│                         │  └────────────────────────┘ │    │
│                         └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

1. **`src/lib/tts/ttsWorkerScript.ts`** - The actual worker code
   - Loads Kokoro TTS model
   - Performs ONNX inference
   - Detects and uses WebGPU when available
   - Returns audio as ArrayBuffer

2. **`src/lib/tts/ttsWorker.ts`** - Worker manager
   - Creates and manages the worker
   - Promise-based API for synthesis
   - Handles message passing
   - Provides fallback detection

3. **`src/lib/tts/streamingTTSGenerator.ts`** - Orchestrator
   - Decides which TTS to use (Kokoro Worker vs Web Speech)
   - Manages segment generation
   - Handles playback for both audio types

4. **`vite.config.ts`** - Cross-origin isolation headers
   - `Cross-Origin-Opener-Policy: same-origin`
   - `Cross-Origin-Embedder-Policy: require-corp`
   - Required for SharedArrayBuffer support

### Cross-Origin Isolation

Web Workers with SharedArrayBuffer require specific HTTP headers:

```typescript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
}
```

### Fallback Strategy

```typescript
// Priority order:
// 1. Kokoro TTS via Web Worker (high quality, non-blocking)
// 2. Web Speech API (lower quality, always works)

if (await isKokoroAvailable()) {
  await generateWithKokoroWorker(script, config, onProgress, onAudioReady);
} else {
  await generateWithWebSpeech(script, config, onProgress, onAudioReady);
}
```

### WebGPU Acceleration

When WebGPU is available, Kokoro uses GPU acceleration for ~20x speedup:

```typescript
// In ttsWorkerScript.ts
const hasWebGPU = await checkWebGPU();
if (hasWebGPU) {
  options.device = 'webgpu';
}
```

### Benefits of This Approach

| Aspect | Before (Main Thread) | After (Web Worker) |
|--------|---------------------|-------------------|
| UI Responsiveness | Blocked 2-5s per segment | Always responsive |
| Voice Quality | High (Kokoro) | High (Kokoro) |
| User Experience | "Page Unresponsive" dialogs | Smooth, no freezes |
| Background Generation | Not possible | Fully supported |
| Tab Switching | Would freeze | Works normally |

---

## Alternative Options (For Reference)

### Option 1: Server-Side TTS
Move TTS generation to a backend server:
```typescript
const response = await fetch('/api/tts', {
  method: 'POST',
  body: JSON.stringify({ text, voice }),
});
const audioBlob = await response.blob();
```
- Pros: High quality, doesn't block browser
- Cons: Requires server infrastructure, network latency

### Option 2: Hybrid Approach
- Use Web Speech for real-time preview
- Generate high-quality audio in background
- Offer "Download HD Audio" option

---

## Conclusion

The "Page Unresponsive" issue has been resolved by moving Kokoro TTS inference to a Web Worker. This provides:

1. **High-quality neural TTS** - Same great Kokoro voices
2. **Non-blocking UI** - Page stays responsive during generation
3. **WebGPU acceleration** - 20x speedup when available
4. **Automatic fallback** - Web Speech API if workers aren't supported

The implementation uses cross-origin isolation headers to enable SharedArrayBuffer, which is required for ONNX threading in Web Workers. Users get the best possible experience: high-quality audio without any UI freezing.
