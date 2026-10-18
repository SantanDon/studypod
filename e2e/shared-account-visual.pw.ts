import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createSharedMutationPolicy, validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { openSharedAccountLogin } from './shared-account-auth';
import { sanitizeSharedErrors, sharedFailureCategory } from './shared-account-diagnostics.mjs';

// No automatic screenshots/traces: dashboard/profile and credentials must never be captured.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => { sanitizeSharedErrors(testInfo.errors); });

async function read(page: Page, path: string) {
  return page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, body: response.ok ? await response.json() : null };
  }, path);
}

test('shared visual: owned Cedar source, original identity and responsive notebook navigation', async ({ browser }, testInfo) => {
  const origin = validateSharedAccountEnvironment(process.env);
  const policy = createSharedMutationPolicy(origin);
  const marker = 'Cedar visual QA ' + randomUUID();
  const artifactRoot = resolve(process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/release-20261018/shared-visual-acceptance');
  mkdirSync(artifactRoot, { recursive: true });
  const receipt = {
    phase: 'login', status: 'started', origin, notebookId: '',
    credentialsPersisted: false, syntheticContentOnly: true, generationRequested: false,
    mockedNetwork: false, legacy106Eligible: false, cleanup: 'not-created',
    cleanupDeleteStatus: 0, cleanupReadStatus: 0, failureCategory: '',
    currentStep: 'login', completedSteps: [] as string[], failureProbe: {} as Record<string, unknown>,
    limitations: ['No generated chat bubble or audio playback is exercised by this visual-only gate.'],
    deniedRequests: [] as { method: string; path: string; reason?: string; quarantined: boolean }[],
    screenshots: [] as string[], checks: {} as Record<string, unknown>,
  };
  const receiptPath = resolve(artifactRoot, 'visual-journey-receipt.json');
  const persist = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, colorScheme: 'light', serviceWorkers: 'block' });
  let page: Page | undefined;
  let notebookId = '';
  persist();
  await context.route('**/*', async route => {
    const request = route.request();
    const decision = policy.decide(request.url(), request.method());
    if (!decision.allowed) {
      receipt.deniedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, reason: decision.reason, quarantined: decision.quarantined === true });
      await route.abort('blockedbyclient'); return;
    }
    // Prevent even accidental reads of another notebook's content; dashboard inventory is not captured.
    const requestedNotebook = /^\/api\/notebooks\/([a-zA-Z0-9-]+)(?:\/|$)/.exec(new URL(request.url()).pathname)?.[1];
    if (requestedNotebook && !policy.ids().includes(requestedNotebook)) {
      receipt.deniedRequests.push({ method: request.method(), path: '/api/notebooks/[unowned]', reason: 'unowned-notebook-read', quarantined: false });
      await route.abort('blockedbyclient'); return;
    }
    if (decision.captureCreated) {
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() === 201) { policy.registerCreated((await response.json()).id); receipt.cleanup = 'pending'; }
      await route.fulfill({ response }); return;
    }
    await route.continue();
  });
  async function step(name: string, action: () => Promise<void>) {
    receipt.currentStep = name; persist();
    await action();
    receipt.completedSteps.push(name); persist();
  }
  async function capture(name: string) {
    expect(new URL(page!.url()).pathname).toBe('/notebook/' + notebookId);
    const geometry = await page!.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      background: getComputedStyle(document.querySelector('header')!).backgroundColor,
      rootBackground: getComputedStyle(document.querySelector('header')!.parentElement!).backgroundColor,
    }));
    expect(geometry.document, 'No horizontal viewport overflow').toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.background, 'Original white header surface').toBe('rgb(255, 255, 255)');
    expect(geometry.rootBackground, 'Original white notebook surface').toBe('rgb(255, 255, 255)');
    receipt.checks[name] = geometry;
    const path = resolve(artifactRoot, name + '.png');
    await page!.screenshot({ path, fullPage: false, animations: 'disabled' });
    receipt.screenshots.push(path); persist();
  }
  async function audioControls() {
    const prefix = receipt.phase;
    const card = page!.getByTestId('audio-overview-studio-card');
    await step(prefix + ':studio-heading', async () => {
      await expect(page!.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
    });
    // The section and inner card intentionally both have an Audio Overview heading.
    await step(prefix + ':audio-card-heading', async () => {
      await expect(card.getByRole('heading', { name: 'Audio Overview', exact: true })).toBeVisible();
    });
    await step(prefix + ':customize-audio', async () => {
      await expect(card.getByRole('button', { name: 'Customize audio', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Customize audio', exact: true })).toBeEnabled();
    });
    await step(prefix + ':voice-settings', async () => {
      await expect(card.getByRole('button', { name: 'Voice and provider settings', exact: true })).toBeVisible();
    });
    await step(prefix + ':white-audio-palette', async () => {
      const palette = await card.locator('.studypod-audio-card').evaluate(element => ({
        card: getComputedStyle(element).backgroundColor,
        listen: getComputedStyle(element.querySelector('.studypod-listen')!).backgroundColor,
        create: getComputedStyle(element.querySelector('.studypod-create')!).backgroundColor,
      }));
      receipt.checks.audioPalette = palette;
      expect(palette.card).toBe('rgb(255, 255, 255)');
      expect(palette.listen).toBe('rgb(255, 255, 255)');
      expect(palette.create).toBe('rgb(255, 255, 255)');
    });
  }
  try {
    page = await openSharedAccountLogin(context, origin);
    await page.getByLabel('Email Address').fill(process.env.STUDYPOD_SHARED_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_SHARED_PASSWORD!);
    const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/signin' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signedIn).status()).toBe(200);
    await page.waitForURL(url => url.pathname === '/');
    const profile = await read(page, '/api/user/profile');
    expect(profile.status).toBe(200);
    expect(profile.body?.user?.email === process.env.STUDYPOD_SHARED_EMAIL, 'Approved identity matches without persisting it').toBe(true);
    policy.verifyIdentity(); receipt.checks.identityVerified = true;
    receipt.phase = 'create-own-notebook'; persist();
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/notebooks' && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
    expect((await created).status()).toBe(201);
    await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    notebookId = new URL(page.url()).pathname.split('/').pop()!;
    expect(policy.ids()).toEqual([notebookId]); receipt.notebookId = notebookId;
    const renameStatus = await page.evaluate(async ({ id, title }) => (await fetch('/api/notebooks/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    })).status, { id: notebookId, title: marker });
    expect(renameStatus).toBe(200);
    receipt.phase = 'paste-real-source'; persist();
    await page.getByRole('button', { name: /^(?:Add|Add a source)$/ }).first().click();
    await page.getByRole('button', { name: /Pasted Content/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(marker);
    await page.getByLabel('Content', { exact: true }).fill('Cedar fixture is a synthetic study notebook. Cedar has 17 blue trays and 4 indigo books. Mina checks each tray every Friday. This invented text exists only for visual acceptance.');
    await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
    await expect.poll(async () => {
      const response = await read(page!, '/api/notebooks/' + notebookId + '/sources');
      const sources = Array.isArray(response.body) ? response.body : response.body?.sources || [];
      return sources.some((source: { title: string; processingStatus: string; content: string }) => source.title === marker && ['completed', 'degraded'].includes(source.processingStatus) && /17 blue trays/.test(source.content || ''));
    }, { timeout: 120000, message: 'Own pasted source has usable persisted synthetic text' }).toBe(true);
    receipt.checks.realSourcePersisted = true;
    await page.reload();
    receipt.phase = 'desktop-visual'; persist();
    await step('desktop-visual:sources-heading', async () => {
      await expect(page!.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    });
    await step('desktop-visual:study-chat-heading', async () => {
      await expect(page!.getByRole('heading', { name: 'Study Chat', exact: true })).toBeVisible();
    });
    await audioControls();
    receipt.currentStep = 'desktop-visual:blue-indigo-logo'; persist();
    const gradient = await page.locator('header .bg-gradient-to-br').first().evaluate(element => getComputedStyle(element).backgroundImage);
    receipt.checks.logoGradient = gradient;
    expect(gradient).toContain('37, 99, 235');
    expect(gradient).toContain('67, 56, 202');
    receipt.completedSteps.push(receipt.currentStep);
    await step('desktop-visual:screenshot-and-overflow', () => capture('desktop-1440x900'));
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ['Sources', 'Chat', 'Studio']) {
      receipt.phase = 'mobile-' + name.toLowerCase(); persist();
      const tab = page.getByRole('tab', { name, exact: true });
      receipt.currentStep = receipt.phase + ':select-tab'; persist();
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => tab.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
      receipt.completedSteps.push(receipt.currentStep);
      receipt.currentStep = receipt.phase + ':panel-heading'; persist();
      if (name === 'Sources') await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
      if (name === 'Chat') await expect(page.getByRole('heading', { name: 'Study Chat', exact: true })).toBeVisible();
      if (name === 'Studio') await audioControls();
      await step(receipt.phase + ':screenshot-and-overflow', () => capture('mobile-390x844-' + name.toLowerCase()));
    }
    receipt.status = 'passed'; receipt.phase = 'cleanup';
  } catch (error) {
    receipt.status = 'failed'; receipt.failureCategory = sharedFailureCategory(error);
    // Persist only fixed locator counts and geometry from our own synthetic notebook.
    // No raw error, text, DOM, account inventory, or credentials enter the receipt.
    if (page && !page.isClosed() && notebookId && new URL(page.url()).pathname === '/notebook/' + notebookId) {
      try {
        receipt.failureProbe = {
          viewport: page.viewportSize(),
          sourcesHeadings: await page.getByRole('heading', { name: 'Sources', exact: true }).count(),
          chatHeadings: await page.getByRole('heading', { name: 'Study Chat', exact: true }).count(),
          studioHeadings: await page.getByRole('heading', { name: 'Studio', exact: true }).count(),
          audioHeadings: await page.getByRole('heading', { name: 'Audio Overview', exact: true }).count(),
          scopedAudioHeadings: await page.getByTestId('audio-overview-studio-card').getByRole('heading', { name: 'Audio Overview', exact: true }).count(),
          customizeButtons: await page.getByRole('button', { name: 'Customize audio', exact: true }).count(),
        };
      } catch { receipt.failureProbe = { unavailable: true }; }
    }
    persist(); throw error;
  } finally {
    const ownedId = notebookId || policy.ids()[0];
    if (ownedId && page && !page.isClosed()) {
      try {
        receipt.cleanupDeleteStatus = await page.evaluate(async id => (await fetch('/api/notebooks/' + id, { method: 'DELETE' })).status, ownedId);
        receipt.cleanupReadStatus = (await read(page, '/api/notebooks/' + ownedId)).status;
        receipt.cleanup = receipt.cleanupDeleteStatus >= 200 && receipt.cleanupDeleteStatus < 300 && receipt.cleanupReadStatus === 404 ? 'verified-deleted' : 'failed';
      } catch { receipt.cleanup = 'failed'; }
    }
    if (receipt.cleanup === 'failed') receipt.status = 'failed';
    persist();
    await testInfo.attach('shared-account-receipt', { body: Buffer.from(JSON.stringify(receipt)), contentType: 'application/json' });
    await context.close();
  }
  expect(receipt.cleanup, 'Own synthetic notebook deletion confirmed by read-back').toBe('verified-deleted');
});
