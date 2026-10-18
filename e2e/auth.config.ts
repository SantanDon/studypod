import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.auth.local', quiet: true });

export default defineConfig({
  testDir: '.', testMatch: 'authenticated.auth.ts',
  timeout: 120_000, expect: { timeout: 20_000 },
  workers: 1, retries: 0, fullyParallel: false,
  outputDir: process.env.STUDYPOD_AUTH_ARTIFACTS || '.ai-bridge/studypod-auth-gate',
  reporter: [['./auth-reporter.ts']],
  use: {
    actionTimeout: 20_000, navigationTimeout: 30_000,
    isMobile: process.env.STUDYPOD_AUTH_MOBILE === '1', hasTouch: process.env.STUDYPOD_AUTH_MOBILE === '1',
    baseURL: process.env.STUDYPOD_AUTH_BASE_URL,
    viewport: process.env.STUDYPOD_AUTH_MOBILE === '1' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block',
  },
});
