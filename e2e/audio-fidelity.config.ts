import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'audio-fidelity.pw.ts', workers: 1, retries: 0,
  timeout: 240_000, expect: { timeout: 15_000 }, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4182', viewport: { width: 1440, height: 900 },
    trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' },
});
