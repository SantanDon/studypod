import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: ['populated-notebook-deletion.pw.ts', 'account-lifecycle.pw.ts', 'full-flow.pw.ts', 'source-downstream.pw.ts', 'source-interaction.pw.ts', 'studio-chat-actions.pw.ts', 'studio-extended.pw.ts', 'studio-audio.pw.ts', 'studio-quiz-journey.pw.ts', 'studio-task-capture.pw.ts', 'studio-flashcard-review.pw.ts', 'studio-quiz-true-false.pw.ts', 'module-load-recovery.pw.ts', 'guest-upload-recovery.pw.ts', 'signed-in-upload-recovery.pw.ts', 'upload-validation.pw.ts', 'source-save-outage.pw.ts', 'upload-queue-reload.pw.ts', 'guest-upload-queue-reload.pw.ts'], timeout: 240_000,
  expect: { timeout: 20_000 }, workers: 1, retries: 0,
  outputDir: process.env.STUDYPOD_AUTH_ARTIFACTS,
  reporter: [['./full-flow-reporter.ts']],
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', grep: /account-lifecycle-|intake-paste|grounded-chat|studio-note|studio-map|studio-chat-actions-|studio-audio-|upload-recovery|upload-validation|source-save-outage|upload-queue-reload|studio-quiz-journey|studio-task-capture|studio-flashcard-mixed-review|studio-quiz-true-false|module-load-recovery|source-downstream-|source-interaction-|studio-extended-/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  use: { baseURL: 'http://127.0.0.1:4182', viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000, trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' },
});
