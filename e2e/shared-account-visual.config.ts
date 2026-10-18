import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';

process.env.STUDYPOD_SHARED_ARTIFACTS ||= resolve('.ai-bridge/release-20261018/shared-visual-acceptance');

export default defineConfig({
  testDir: '.',
  testMatch: 'shared-account-visual.pw.ts',
  workers: 1,
  retries: 0,
  timeout: 300000,
  expect: { timeout: 25000 },
  outputDir: process.env.STUDYPOD_SHARED_ARTIFACTS,
  reporter: [['./shared-account-full-reporter.ts']],
  use: {
    baseURL: validateSharedAccountEnvironment(process.env, false),
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    actionTimeout: 25000,
    navigationTimeout: 30000,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
