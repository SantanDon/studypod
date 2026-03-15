# Audio Pipeline Documentation

## Overview
The audio generation pipeline processes notebook content into a high‑quality podcast audio file. The flow consists of the following stages:

1. **Content Preparation** – `generatePodcastScript` optionally summarises notebook sections using `AIService.generateSummary` and builds a prompt for the LLM.
2. **Script Generation** – The LLM returns a JSON script containing a title and dialogue segments.
3. **Script Cleaning** – `AudioContentCleaner.cleanForAudio` removes markdown, citations, and normalises text. In *preserveContext* mode (used for standard podcasts) the original text is kept to retain context.
4. **Audio Generation** – `PodcastAudioGenerator` selects a TTS provider (Kokoro Premium, Ultimate TTS, or a Web‑Worker based Kokoro) and synthesises each segment, optionally using a worker for background processing.
5. **Audio Combination** – Segments are combined via the Web Audio API, respecting the configured pause between segments.
6. **Saving & Playback** – The combined blob is saved to Podcast History and played back in `PodcastView`.

## Configurable Settings (`PodcastAudioConfig`)
- `host1Voice`, `host2Voice` – voice IDs for Alex and Sarah.
- `speed` – playback speed multiplier.
- `pauseBetweenSegments` – silence duration (ms) between segments.
- `usePremiumForDeepThink` – enable premium Kokoro for Deep‑Think mode.
- `usePremiumVoices` – force premium voices for all modes.

## Running Tests
```bash
npm test
```
The test suite includes:
- Unit tests for `AudioContentCleaner` (preserveContext flag).
- Integration test for full podcast generation (mocked AI and TTS providers).
- PDF extraction flow test to verify the extraction API returns a result object.

## Extending the Pipeline
- Add new TTS providers by implementing the `TTSProvider` interface and registering in `getTTSConfig`.
- Adjust summarisation granularity by modifying the loop in `generatePodcastScript`.
- Tune segment length thresholds in `createExpandedScript`.

## Known Limitations
- Summarisation currently runs sequentially; may be parallelised in the future.
- Preserve‑context mode currently returns the original text unchanged (no aggressive cleaning).
- PDF extraction relies on PDF.js and may need additional OCR tuning for scanned documents.

---
Generated with Claude Code.
