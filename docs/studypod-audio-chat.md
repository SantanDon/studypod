# StudyPod chat-controlled audio

## Scope

The September 2026 patch connects explicit user chat commands to the existing Audiobook and Podcast Studio handlers. It does not introduce a second synthesis service or a general LLM tool-execution framework. VoiceLab is a separate project and is not a dependency.

## User flow

A request such as `Read this whole PDF aloud`, `Make a podcast about planetary orbits`, or `Resume my audiobook` creates an audio action card. The user selects the source and confirms the action. The matching Studio view consumes the request once and reports whether it actually started. Ordinary questions about podcasts, quoted source content, ambiguous requests mentioning both audio types, and negative instructions do not automatically generate audio.

`Check my podcast status`, `Cancel my podcast`, and `Download my audiobook` route to the corresponding status/cancellation/Studio controls. Download requests open the existing player/download view; they do not invent an artifact URL before an export is ready. Podcast audio can also play in the chat action card once a blob is available.

Full narration requires a source with a server-side book manifest (`metadata.fileName` and chapter metadata) and the local audiobook runtime. A normal PDF upload lacking that manifest must first be imported through Audiobook Studio. An explicit chapter/page request opens the chapter selector rather than silently rendering the entire book.

## State, scoping and safety

`src/lib/audio/studioAudioCommands.ts` stores a memory-only, notebook-scoped request with draft, queued, executing and accepted/failed states. Generation requires confirmation. Claims are atomic within the browser store; queued requests expire after one minute. Reloading the page cannot replay an old unconfirmed command. This request store is not the durable audio job store.

The Studio consumer revalidates selected IDs against its current source list. A selected-source podcast excludes other sources and unselected notebook notes from its script prompt. The existing backend authenticates audiobook operations and now requires explicit manifest ownership; ownerless legacy files are not automatically claimed. Such files require re-import or a separately reviewed ownership migration.

Podcast callbacks are scoped to the initiating notebook and script. Cancellation during script preparation discards the eventual script before synthesis. Late callbacks from a cancelled job cannot overwrite another notebook's active generation. Duplicate browser starts are guarded. Backend full-render admission is serialized per owner/book until the controller finishes creating or reusing a durable job. That admission guard is process-local, consistent with the existing local worker architecture; it is not a distributed queue lock.

## Integrity changes

The browser WAV fallback converts supported numeric samples to PCM16 rather than labelling floating-point bytes as integer PCM. It rejects unsupported or inconsistent formats, sample-rate/channel mismatches, missing segments, non-finite samples and oversized output. Turn gaps remain explicit. This fallback requires compatible rates/channels; it does not pretend to resample by rewriting a header.

Audiobook WAV cache validation checks declared container/data sizes and sample metadata. Truncated caches are not reusable. Selected chapters are deduplicated into document order; unknown or empty explicitly selected chapters fail instead of disappearing silently. Full-render completion requires each selected chapter and an export duration consistent with all chapter durations. Large WAV exports use FFmpeg RF64 auto mode.

These checks establish container integrity and planned chapter accounting, not proof that a speech model pronounced every word correctly.

## Limits that must remain visible

- Podcast generation remains browser-based. Closing/reloading the page does not have a new durable resume mechanism; chat reports that limitation instead of claiming a resumed job.
- Audiobook cancellation uses the owned `POST /api/audiobook/job-status/:id/cancel` endpoint and requires exactly one selected book. Recording cancellation and final publication are serialized under the same book lock. `cancelling` and `workerActive` distinguish a recorded request from a stopped worker; speech inference stops cooperatively at a checkpoint, not necessarily instantly. Explicit retries wait for the previous worker to finish and use a new job identity. This remains a single-coordinator, same-host runtime, not a distributed queue.
- Full-document extraction, actual narration, voice naturalness, accessibility in real browsers, long-duration resource use, playback and authenticated downloads still need the corresponding end-to-end acceptance evidence.
- No speech engine was replaced or trained by this patch. The paused Plato run was not resumed.

## Reproducible checks

```sh
npm run typecheck
node --check backend/src/routes/audiobook.js
node node_modules/vitest/vitest.mjs run --maxWorkers=2 audiobook podcast pcmWav studioAudioCommands StudioAudioCommandCard StudioSidebar ChatArea MobileNotebookTabs
npm run build
```

Task-local evidence and review logs are in `.ai-bridge/studypod-audio-20260929/`. `verify-audio-exports.mjs` uses synthetic tones and installed FFmpeg to verify WAV, MP3, M4B, RF64 and browser float-to-PCM conversion; it is deliberately not described as a listening or speech-generation test. No push or deployment is authorized by passing these checks.
