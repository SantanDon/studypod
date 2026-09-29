# Infrastructure hardening: reviewed changes and operating limits

## Reviewed implementation

This change set follows a source-only implementation, independent review, and feedback/refinement cycle. It adds no dependency or paid service. Runtime and source-content permissions are not broadened.

### Bounded database-read retries

`backend/src/utils/databaseRetry.js` now normalizes attempt counts and backoff values. Previously, a non-finite attempt count could skip the operation (`NaN`) or allow unbounded retries (`Infinity`).

The default remains three attempts with a 250 ms base delay. Attempt counts are floored and bounded to 1–10. Base delay is bounded to 0–5,000 ms, and each sleep including jitter is capped at 5,000 ms. Only numbers and non-blank numeric strings are coerced. Non-finite values, blank strings, objects, symbols and other unsupported values use the applicable default instead of triggering user-defined numeric coercion. Explicit zero delay creates no wait timer or jitter.

Retries still apply only to classified transient failures. The original terminal error is rethrown and the operation receives its one-based attempt number. These limits bound retry scheduling, not the execution time of an individual database request. Callers remain responsible for request cancellation/timeouts where needed.

The existing database retry tests remain unchanged. Additional regression coverage is in `backend/src/__tests__/databaseRetryBounds.test.js`.

### Preserve the last valid audiobook manifest

`saveBookManifest` in `backend/src/services/audiobookBookService.js` stages the serialized result in a unique file in the manifest directory, then replaces the manifest with a rename. It no longer falls back to copying bytes over the live manifest.

**Intentional behavior change:** when atomic replacement is blocked, including Windows sharing/permission errors, the save fails and preserves the old manifest. The caller may retry. A failed update is preferable to truncating the only valid progress/bookmark record. A temporary-write or rename failure attempts cleanup without hiding the original error. Cleanup is best effort if the filesystem also denies deletion.

The document format and normal successful replacement behavior are unchanged. No claim of power-loss durability is made: this change is not a filesystem synchronization or distributed storage design. The job JSON persistence in the audio route remains a separate implementation and should not be assumed to inherit this safeguard.

Synthetic fault-injection tests cover successful replacement, blocked rename, partial temporary writes, serialization failures and preservation of the previous bytes. See `backend/src/__tests__/saveBookManifest.durability.test.js`.

### Existing dependency security pins

The final dependency audit identified advisories affecting the existing `ip-address` and `undici` overrides. Their pins and lockfile entries were updated narrowly to `ip-address` 10.5.1 and `undici` 7.29.1. No new package was introduced and no audit rule was weakened. The post-update production audit reported zero vulnerabilities at the time of review; this is not a guarantee against future advisories.

## Related audio work

The accompanying patch connects explicit chat requests to existing Studio audio handlers with source confirmation; validates selected narration chapters and audio cache integrity; correctly converts podcast PCM samples; and guards the worker against announcing completion for an unexpected result. The detailed user-flow and limitations are recorded in `docs/studypod-audio-chat.md`.

## Remaining infrastructure work

The public serverless site still needs a supported long-running speech worker and private persistent storage before full audiobook creation can be described as an online production feature. Local process success or a generic healthy API response does not establish these capabilities. Do not enable the public audio capability flag merely to remove a warning.

The existing Docker packaging requires an executable audit of runtime dependencies, speech binaries, writable/persistent directories and recovery. No container deployment was validated by this change set.

Complete-book spoken-content coverage, subjective listening and actual application playback/authenticated-download acceptance remain distinct checks. Unit tests, generated diagnostic audio and a successful frontend build cannot substitute for them. Any protected agent-context permission changes and live-account actions must follow their normal authorization path.

## Reproduction

```sh
npm run typecheck
npm run lint
npm test -- --run --maxWorkers=2
npm run build
npm run check:bundle
```

Focused infrastructure regression tests:

```sh
node node_modules/vitest/vitest.mjs run backend/src/__tests__/databaseRetry.test.js backend/src/__tests__/databaseRetryBounds.test.js backend/src/__tests__/saveBookManifest.durability.test.js
```

Test output and final candidate identity belong in the associated review/CI receipt. A branch push is not an assertion that the remaining online audio release conditions have been satisfied.
