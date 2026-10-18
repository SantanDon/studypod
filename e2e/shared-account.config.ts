import { defineConfig } from '@playwright/test';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { resolve } from 'node:path';
const baseURL = validateSharedAccountEnvironment(process.env, false);
export default defineConfig({
  testDir: '.', testMatch: 'shared-account.pw.ts', workers: 1, retries: 0,
  timeout: 180_000, expect: { timeout: 20_000 },
  outputDir: resolve(process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/shared-account-acceptance'),
  reporter: [['./shared-account-reporter.ts']],
  use: { baseURL, viewport: { width: 1440, height: 900 }, actionTimeout: 20_000, navigationTimeout: 30_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off', ignoreHTTPSErrors: false },
});
