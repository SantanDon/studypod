import { defineConfig } from '@playwright/test';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
export default defineConfig({
  testDir: '.', testMatch: 'shared-account-audiobook.pw.ts', workers: 1, retries: 0,
  timeout: 900_000, expect: { timeout: 25_000 },
  outputDir: process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/release-20261018/audiobook-readiness/live',
  reporter: [['./shared-account-full-reporter.ts']],
  use: { baseURL: validateSharedAccountEnvironment(process.env, false), viewport: { width: 1440, height: 900 }, actionTimeout: 25_000, navigationTimeout: 30_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' },
});
