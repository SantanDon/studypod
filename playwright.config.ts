import { defineConfig } from '@playwright/test';

const deployedUrl = process.env.STUDYPOD_BASE_URL;
const artifacts = process.env.STUDYPOD_BROWSER_ARTIFACTS || '.ai-bridge/studypod-browser-gate';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  outputDir: `${artifacts}/results`,
  reporter: [['list'], ['json', { outputFile: `${artifacts}/report.json` }], ['html', { outputFolder: `${artifacts}/html`, open: 'never' }]],
  use: {
    baseURL: deployedUrl || 'http://127.0.0.1:4179',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: deployedUrl ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
