import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
process.env.STUDYPOD_SHARED_ARTIFACTS ||= resolve('.ai-bridge/release-20261018/shared-studio-live');
export default defineConfig({
  testDir: '.', testMatch: 'shared-account-studio.pw.ts', workers: 1, retries: 0,
  timeout: 900_000, expect: { timeout: 25_000 },
  outputDir: process.env.STUDYPOD_SHARED_ARTIFACTS,
  reporter: [['./shared-account-full-reporter.ts']],
  use: { baseURL: validateSharedAccountEnvironment(process.env, false), viewport: { width: 1440, height: 900 }, actionTimeout: 25_000, navigationTimeout: 30_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' },
});
