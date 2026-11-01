import assert from "node:assert/strict";
import test from "node:test";

import {
  awaitAudiobookSpeechWithCancellation,
  createAudiobookRenderAdmission,
} from "../services/audiobookRenderAdmission.js";

test("render admission bounds distinct jobs and frees capacity on release", () => {
  const admission = createAudiobookRenderAdmission(2);

  assert.equal(admission.tryAcquire("job-a"), true);
  assert.equal(admission.tryAcquire("job-b"), true);
  assert.equal(admission.activeCount, 2);
  assert.equal(admission.tryAcquire("job-c"), false);
  assert.equal(admission.tryAcquire("job-a"), false);
  assert.equal(admission.release("job-a"), true);
  assert.equal(admission.tryAcquire("job-c"), true);
  assert.equal(admission.release("job-b"), true);
  assert.equal(admission.release("job-c"), true);
  assert.equal(admission.release("job-c"), false);
  assert.equal(admission.activeCount, 0);
});

test("speech cancellation is checked before and after awaited synthesis", async () => {
  const events = [];
  const value = await awaitAudiobookSpeechWithCancellation(
    () => events.push("check"),
    async () => {
      events.push("speech-start");
      await Promise.resolve();
      events.push("speech-end");
      return "audio";
    },
  );

  assert.equal(value, "audio");
  assert.deepEqual(events, ["check", "speech-start", "speech-end", "check"]);
});

test("speech cancellation prevents synthesis and rejects after an in-flight wait", async () => {
  let cancelled = false;
  let speechStarted = false;

  await assert.rejects(
    awaitAudiobookSpeechWithCancellation(
      () => {
        if (cancelled) throw new Error("cancelled");
      },
      async () => {
        speechStarted = true;
        cancelled = true;
      },
    ),
    /cancelled/,
  );
  assert.equal(speechStarted, true);

  cancelled = true;
  speechStarted = false;
  await assert.rejects(
    awaitAudiobookSpeechWithCancellation(
      () => {
        if (cancelled) throw new Error("cancelled");
      },
      async () => {
        speechStarted = true;
      },
    ),
    /cancelled/,
  );
  assert.equal(speechStarted, false);
});
