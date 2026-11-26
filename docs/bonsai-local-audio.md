# Bonsai and StudyPod local audio

## Foundation review — 15 November 2026

Keep the existing pipeline. StudyPod already separates source selection, grounded podcast scripts, speech synthesis, and saved playback. Brief/Standard podcasts compile selected source passages; Deep Dive creates a discussion and separately checks every turn against its evidence. Audiobooks narrate the extracted book through Kokoro, with durable jobs and cached chapter audio. Bonsai should not rewrite book text before narration.

The integration needed narrow fixes, rather than a second audio engine or another orchestration layer:

- Model settings initialized obsolete hardcoded models and could save them over the environment selection. New settings now use the shared task-model resolver; explicit saved choices remain authoritative.
- Local requests forced thinking off. Thinking now has an opt-in setting, an additional 8,192-token allowance, and a bounded deadline through response-body consumption.
- The streaming parser discarded JSON records split across network chunks. It now buffers records and UTF-8 correctly, requires completion, and rejects server errors and token exhaustion.
- Empty answers could fall back to serialized response metadata. They now fail explicitly, keeping reasoning metadata out of scripts and narration.

No new runtime dependency or parallel implementation was added. Existing unrelated checkout changes were preserved.

## Local configuration

The ignored `.env.local` on this machine selects:

```dotenv
VITE_ENABLE_OLLAMA=true
VITE_OLLAMA_URL=http://localhost:11434
VITE_OLLAMA_MODEL=bonsai-2:27b
VITE_OLLAMA_THINK=true
VITE_OLLAMA_CONTEXT=65536
```

Restart Vite after changing environment settings. If an existing browser profile has an explicit old model choice, select `bonsai-2:27b` in its local model settings. Embeddings remain a separate model/task; Bonsai is not an embedding replacement. No embedding model was installed for this test.

Verified installed model: `bonsai-2:27b`, digest prefix `f3c4f4208659`, Q2_0. Its exposed reasoning control is Boolean `think: true`; there is no separate verified high/xhigh setting. Requests retain the model's top-k/top-p defaults while the task controls temperature. Reasoning requests bypass response caching; existing audio/chapter caching remains enabled.

## Live acceptance evidence

Initial tests used the real local UI, real Ollama and Kokoro, an original ~190-word story, an isolated guest browser profile, and a separate local database/storage directory. These establish integration and playback only. The one-minute Deep Dive was a short-fixture result, not acceptance of long-form depth or chapter coverage.

| Journey | Result |
| --- | --- |
| Brief podcast | Bonsai request captured with thinking enabled and 65,536 context; one model request, no repair/fallback. About 240 seconds including cold browser TTS startup; 72 seconds of two-host WAV audio. |
| Deep Dive podcast | Bonsai drafted the dialogue and ran the separate evidence verifier, both with thinking enabled. Four speech segments completed in about 240 seconds total; 62.575 seconds of two-voice WAV audio. Play, pause, seek, download, and saved position after reload passed. |
| Podcast playback | Play, pause, seek, download, and saved position after reload passed. Download decoded as mono 24 kHz PCM. |
| Audiobook sample | 34 seconds of Kokoro audio, 1,632,114 bytes; actual browser playback advanced. |
| Complete short audiobook | All 3 extracted sections completed in about 88 seconds; MP3 duration 71.63 seconds, 573,693 bytes. |
| Audiobook playback | Chapter selection, play/pause, forward seek, bookmark, download, and position/bookmark restoration after reload passed. Download decoded successfully. |

The initial Playwright network-response capture reported zero preview bytes. Reading the actual browser audio blob and checking playback established that the preview was valid; no product patch was needed for that test artifact.

Evidence lives under ignored `.ai-bridge/`: `bonsai-podcast-requests.json`, `bonsai-audio-acceptance.json` (podcast assertions passed before an obsolete audiobook selector failed), `bonsai-audiobook-playback.json`, saved screenshots, WAV/MP3 downloads, and backend job state. The successful audiobook checks supersede that earlier selector failure.

Deep Dive evidence: `bonsai-deep-dive.log`, `bonsai-deep-dive.json`, `bonsai-deep-dive-playback.json`, and `bonsai-deep-dive.wav` (3,003,644 bytes, decoded successfully). These prove generation and usable media, not a human listening-quality assessment.

Verification: 123 baseline focused frontend tests; 43 final routing/configuration/client/hook tests; 14 backend runtime/Kokoro tests; 3 backend render-admission tests. Typecheck, production build, and diff whitespace checks passed. Targeted lint had no errors and two existing warnings. Build retained existing large-chunk and Browserslist-age warnings.

## Substantial-chapter validation

The follow-up uses the 11,530-word Book VII of Plato's *Republic*. It exercises ten initial source batches for Deep Dive and six narration sections for the audiobook. The incremental Deep Dive evaluation (`.ai-bridge/bonsai-substantial-feedback*.json`) stopped at section six after 2,785 seconds: the verifier correctly rejected reversed speaker attributions. No audio was produced. Prompts now require neutral narration for unlabelled dialogue, including during repairs, and short retrieval questions whose answers are taught in the discussion. A fresh run with no replay (`.ai-bridge/bonsai-substantial-fresh-depth*.json`) failed after 812 seconds when section two exhausted its token allowance without a draft. Token-exhausted draft batches now split into smaller groups of complete passages, preserving order and previously verified sections. Single-passage failures stop, and the shared deadline still bounds the operation. An incremental retry reused the two successful first-section responses, but later stopped when Ollama became unavailable. Its partial results were not treated as a completed episode.

Deep Dive now considers every indexed substantive passage in source order, instead of silently stopping after four batches. Each section receives separate factual and material-coverage checks, with one bounded revision and, if only coverage remains incomplete, one additional revision. Checks look for central arguments, reasoning, representative examples, and important qualifications; they do not demand every repeated phrase or add material to fill time. All sections must pass before recording starts. Evidence references use known passage IDs rather than asking the model to reproduce quote metadata. This reduces formatting failures while retaining canonical-source verification. Model review is fallible: manual inspection of the complete chapter discussion remains part of this acceptance exercise.

Preparation now reports which section is being explained, reviewed, or revised, survives notebook-tab navigation, and offers cancellation. An interrupted recording can restart from its saved, prepared script using current voice settings without another model draft. This restart begins audio synthesis from the start; it does not claim to resume completed speech segments. Prepared scripts expire after 24 hours, and users are told to keep the page open during drafting.

The full audiobook completed all six narration sections. Cancellation, reload, and retry preserved the completed first section. The final download contains 74 minutes 11 seconds of MP3 audio (35,607,240 bytes) and fully decoded without errors. Browser playback, pause, seek, bookmark, download, and restoration of position and bookmark after reload passed. The actual audiobook player was inspected on desktop and at 390px mobile width, with no horizontal overflow. Evidence: `bonsai-long-audiobook.json`, `bonsai-long-audiobook-playback.json`, and `bonsai-audiobook-layout.json` under `.ai-bridge/`. This proves a substantial chapter and its recovery journey, not a whole multi-chapter book or a human listening-quality assessment.

Controlled Deep Dive UI checks passed progress display, notebook-tab navigation, cancellation, prepared-script recovery availability, and mobile layout. These checks use intercepted model responses and prove UI behavior only. The subsequent substantial recording exercised real Kokoro synthesis and saved playback, as detailed below.

Focused checks for the depth, routing, progress, recovery, and chat-command changes: 142 tests across eight files passed. After adding source-scaled episode ceilings, all 74 discussion tests passed, followed by TypeScript validation, production build, and targeted lint. Discussion tests include ordered recovery from token-exhausted multi-passage drafts, bounded failure for a single passage, and ceiling boundaries. These checks supplement the real chapter run; they do not replace it.

The episode ceiling now scales to 60% of source words, with a 4,500-word floor and 9,000-word maximum. This is a maximum, not a requested length. It prevents a fixed ceiling from rejecting a substantial, otherwise grounded chapter discussion; duplicate and coverage checks still apply.

Manual source comparison found that automated review missed qualifications and speaker attributions. Prompt clarifications alone did not reliably detect those errors. The completed incremental validation supplied human corrections for the opening and astronomy sections, reused checked earlier responses, and obtained live repairs and later sections. It produced 5,153 words across ten sections and all 37 indexed passages. Manual source comparison required 13 further copyedits, recorded separately with the original text, replacement and reason. The reviewed test script has 5,196 words and 47 spoken turns. This assisted run is not fresh, unattended quality acceptance; model review alone missed attribution and qualification errors. The earlier adaptive run saved 19 responses before Ollama became unavailable during the next review; it did not produce an accepted episode.

The reviewed script produced **29 minutes 11 seconds** of real two-voice Kokoro audio. Prepared-script recovery did not make another model request. Browser playback advanced, pause/seek worked, the WAV download contained 42,030,644 bytes, and the saved two-second position returned after reload. The download fully decoded without errors. Its mono 12 kHz PCM format reflects the existing size-aware WAV encoder's 48 MiB budget; it is not a full-bandwidth audio-quality certification. The saved player was visually inspected on desktop and at 390px mobile width with no horizontal overflow. There was no full-episode human listening assessment.

The first recording observer incorrectly waited for a server POST, while this isolated guest session saved to IndexedDB. The completed browser recording was reopened and verified without resynthesis. This is guest persistence evidence, not authenticated account upload acceptance. Evidence: `.ai-bridge/bonsai-substantial-recording.json`, `bonsai-substantial.wav`, `bonsai-substantial-decode.txt`, and the saved desktop/mobile screenshots. The source-compared transcript is `.ai-bridge/bonsai-book-vii-deep-dive-transcript.md`; raw output and the 13 manual corrections remain separate in `bonsai-substantial-final.json` and `bonsai-substantial-reviewed.json`.

## Automatic factual review follow-up

Deep Dive now audits individual spoken sentences after the existing section review. Each approval must include exact excerpts from that sentence's own cited passages; incomplete verdicts, invented excerpts and references to other citations fail closed. Rejected claims feed the existing bounded revision step, and the revised section goes through both reviews again before recording. Reviews run in small batches under the existing shared deadline. This adds no dependencies and does not change the source into a desired-duration target.

Exact quotations establish that evidence exists, not that a paraphrase follows from it. A live Bonsai regression against four previously missed error fragments exposed that limitation: the revised checks rejected two original errors but approved two others. Three of four manually corrected controls passed; the rejected control depended on context outside its own cited paragraph. These eight fragment checks are diagnostic evidence, not a representative accuracy score. Strengthening temporal and conditional guidance did not reliably fix the semantic misses. The automatic repair path is implemented, but factual reliability is **not yet established**.

A fresh, untouched Book IX test used 8,933 source words and eight initial sections, real Bonsai with thinking enabled, normal automatic review/revision, and no saved-response replay or manual script edits. It failed in the first section after 643.219 seconds (10m43s); no script or audio was produced. The coverage reviewer returned a valid substantive rejection whose last missing point was 513 characters, exceeding the parser's 500-character limit. Its one retry returned the same response, so automatic revision never started. Terminal evidence: `.ai-bridge/bonsai-substantial-book-ix-unattended.json` and `-responses.json`. Earlier manually corrected Book VII media remains separate.

The parser now accepts bounded coverage feedback up to 1000 characters while still prompting for fewer than 500. This preserves the rejection for repair; it never approves the inadequate section or truncates its feedback. The actual captured verdict now produces all four actionable missing points (`.ai-bridge/bonsai-book-ix-feedback-recovery.json`). This is a captured-response regression check, not another live generation. The full chapter has not been rerun after this handling fix. Known semantic false approvals remain unresolved, so repeating expensive synthesis would not establish unattended factual reliability.

The sentence-review and discussion suites passed 88 tests after the final changes, including paragraph approval followed by sentence rejection and automatic repair, and verbose coverage feedback reaching repair. A broader focused run passed 152 tests before the final adjustments. TypeScript, targeted ESLint, production build and diff whitespace checks passed. Existing bundle-size, mixed-import and Browserslist warnings remain. These checks verify the control flow and evidence parsing, not the model's factual judgment. Autonomous Deep Dive and the overall audio layer are **not release ready**. Audiobook chapter playback evidence is narrower and remains valid.

## Remaining work

- Prove a representative multi-chapter book and fresh, unattended Deep Dive quality before claiming broad long-form readiness. The substantial audiobook chapter and its cancellation/retry journey passed; the manually corrected podcast sample cannot establish autonomous factual reliability.
- Keep the audiobook route's large size in mind when touching it; extract a focused service only when a concrete change needs it. Avoid a broad rewrite during this integration.
- Drafting still requires an open browser page. Interrupted podcast synthesis restarts from the prepared script rather than resuming completed speech segments. These limits should remain explicit in the UI.
- Existing source budget and grounding checks still apply even with a larger model context. Do not relax evidence validation just to force a generation to succeed.

No commit, push, deployment, paid provider, or new model download was performed.
