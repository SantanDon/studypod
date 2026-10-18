import { test, expect } from '@playwright/test';
import { verifyGeneratedAudioFidelity } from './audio-fidelity.integration';

test('saved generated speech → actual browser Whisper-base → retained source/script facts', async ({ page, context }) => {
  test.setTimeout(240_000);
  expect(process.env.STUDYPOD_AUDIO_FIDELITY_MANIFEST).toBeTruthy();
  await verifyGeneratedAudioFidelity(page, context, process.env.STUDYPOD_AUDIO_FIDELITY_MANIFEST!);
});
