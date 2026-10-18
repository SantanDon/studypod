import { expect, type Page, type TestInfo } from '@playwright/test';

export const unavailableAudiobook = {
  voices: [], voiceDetails: {}, narrationProfiles: {}, providers: {},
  capabilities: {
    enabled: false, localBeta: true, bookIngestion: false,
    chapterPreview: false, fullGeneration: false, durableJobs: false,
    reason: 'This test fixture has no audiobook runtime. No audio was created.',
  },
};

export async function observeBrowser(page: Page, testInfo: TestInfo, fixtureMode: boolean) {
  const errors: string[] = [];
  const requests: string[] = [];
  const expectedGuestBootstrap: string[] = [];
  let expectedUnauthorizedConsole = 0;
  let expectedAbortedConsole = 0;
  const blockedBootstrapPaths = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error' || message.text().startsWith('404 Error: User attempted')) return;
    const resourceUrl = message.location().url;
    if (!fixtureMode && /^Failed to load resource: the server responded with a status of 401 \((Unauthorized)?\)$/.test(message.text()) && resourceUrl === `${origin}/api/user/profile` && expectedUnauthorizedConsole > 0) {
      expectedUnauthorizedConsole--;
      expectedGuestBootstrap.push(message.text());
    } else if (!fixtureMode && message.text() === 'Failed to load resource: net::ERR_FAILED' && [...blockedBootstrapPaths].some(path => resourceUrl === `${origin}${path}`) && expectedAbortedConsole > 0) {
      expectedAbortedConsole--;
      expectedGuestBootstrap.push(message.text());
    } else errors.push(message.text());
  });
  page.on('response', response => {
    const url = new URL(response.url());
    const expectedProfile = !fixtureMode && url.origin === origin && url.pathname === '/api/user/profile' && response.request().method() === 'GET' && response.status() === 401;
    if (response.status() >= 400 && !expectedProfile) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      if (!fixtureMode && url.origin === origin && request.method() === 'POST' && ['/api/auth/refresh', '/api/auth/signout'].includes(url.pathname) && !blockedBootstrapPaths.has(url.pathname) && expectedGuestBootstrap.some(item => item === 'GET /api/user/profile 401 (signed-out cookie bootstrap)')) {
        blockedBootstrapPaths.add(url.pathname);
        expectedGuestBootstrap.push(`BLOCKED expected guest bootstrap POST ${url.pathname}`);
        expectedAbortedConsole++;
      } else errors.push(`Forbidden mutation: ${request.method()} ${url.pathname}`);
      await route.abort();
    } else if (url.pathname === '/api/user/profile' && fixtureMode) {
      requests.push('FIXTURE GET user/profile (no signed-in user)');
      await route.fulfill({ json: { user: null } });
    } else if (!fixtureMode && url.origin === origin && url.pathname === '/api/user/profile' && request.method() === 'GET') {
      const response = await route.fetch();
      if (response.status() === 401) {
        expectedGuestBootstrap.push('GET /api/user/profile 401 (signed-out cookie bootstrap)');
        expectedUnauthorizedConsole++;
      }
      await route.fulfill({ response });
    } else if (url.pathname.startsWith('/_vercel/') && fixtureMode) {
      requests.push(`FIXTURE analytics ${url.pathname}`);
      await route.fulfill({ status: 200, body: '', contentType: 'application/javascript' });
    } else if (url.pathname.endsWith('/audiobook/voices') && fixtureMode) {
      requests.push('FIXTURE GET audiobook/voices (unavailable runtime)');
      await route.fulfill({ json: unavailableAudiobook });
    } else if (url.origin !== origin) {
      requests.push(`BLOCKED external GET ${url.origin}${url.pathname}`);
      await route.fulfill({ status: 200, body: '', contentType: 'text/plain' });
    } else {
      await route.continue();
    }
  });
  return async () => {
    await testInfo.attach('browser-observations', { body: JSON.stringify({ fixtureMode, errors, requests, expectedGuestBootstrap }, null, 2), contentType: 'application/json' });
    expect(errors, 'No unexpected browser, HTTP, or mutation errors').toEqual([]);
  };
}

export async function checkLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal document overflow').toBe(true);
}

export async function checkProfileKeyboard(page: Page) {
  const trigger = page.locator('header button[aria-haspopup="menu"]').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
