import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createSharedMutationPolicy, excludedCoverage, validateSharedAccountEnvironment } from './shared-account-policy.mjs';

test('existing shared account: isolated notebook and source survive fresh login', async ({ browser }, testInfo) => {
  const origin = validateSharedAccountEnvironment(process.env);
  const email = process.env.STUDYPOD_SHARED_EMAIL!;
  const password = process.env.STUDYPOD_SHARED_PASSWORD!;
  const policy = createSharedMutationPolicy(origin);
  const marker = `Synthetic QA ${randomUUID()}`;
  const content = `${marker}. Chlorophyll absorbs light. Photosynthesis uses carbon dioxide and water and releases oxygen.`;
  const contexts: BrowserContext[] = [];
  const receipt: Record<string, unknown> = { phase: 'initialization', origin, full106Eligible: false, excludedCoverage, signupAttempts: 0, outOfScopeMutations: 0, cleanup: 'not-created', credentialsPersisted: false };
  let cleanupPage: Page | undefined;
  const read = async (page: Page, path: string) => page.evaluate(async path => {
    const response = await fetch(path); return { status: response.status, json: response.ok ? await response.json() : null };
  }, path);
  const fresh = async () => {
    const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    await context.route('**/*', async route => {
      const request = route.request();
      const decision = policy.decide(request.url(), request.method());
      if (!decision.allowed) {
        const denied = (receipt.deniedRequests ||= []) as unknown[];
        denied.push({ method: request.method(), path: new URL(request.url()).pathname, reason: decision.reason, quarantined: decision.quarantined === true });
        if (decision.reason === 'signup-forbidden') receipt.signupAttempts = Number(receipt.signupAttempts) + 1;
        else if (!decision.quarantined && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) receipt.outOfScopeMutations = Number(receipt.outOfScopeMutations) + 1;
        await route.abort('blockedbyclient'); return;
      }
      if (decision.captureCreated) {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() === 201) {
          const body = await response.json();
          policy.registerCreated(body.id);
          receipt.cleanup = 'pending';
        }
        await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    return context.newPage();
  };
  const login = async (page: Page, wrong = false) => {
    await page.goto('/auth?mode=cloud-login');
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(wrong ? `Incorrect-${randomUUID()}` : password);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signin' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await response).status()).toBe(wrong ? 401 : 200);
    if (wrong) { expect(new URL(page.url()).pathname).toBe('/auth'); return; }
    await page.waitForURL(url => url.pathname === '/');
    const profile = await read(page, '/api/user/profile');
    expect(profile.status).toBe(200);
    // Boolean assertions prevent credentials/profile values appearing in failure output.
    expect(profile.json?.user?.email === email, 'Authenticated identity must match runtime-approved shared account').toBe(true);
    policy.verifyIdentity();
  };
  try {
    receipt.phase = 'existing-login';
    const first = await fresh();
    await login(first);
    cleanupPage = first;
    receipt.phase = 'create-new-notebook';
    const created = first.waitForResponse(r => new URL(r.url()).pathname === '/api/notebooks' && r.request().method() === 'POST');
    await first.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).click();
    expect((await created).status()).toBe(201);
    await first.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    const id = new URL(first.url()).pathname.split('/').pop()!;
    expect(policy.ids()).toEqual([id]);
    const renamed = await first.evaluate(async ({ id, title }) => (await fetch(`/api/notebooks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })).status, { id, title: marker });
    expect(renamed).toBe(200);
    receipt.phase = 'pasted-source';
    await first.getByRole('button', { name: /(?:^|\s)Add$/ }).click();
    await first.getByRole('button', { name: /Pasted Content/ }).click();
    await first.getByLabel('Title', { exact: true }).fill(marker);
    await first.getByLabel('Content', { exact: true }).fill(content);
    const added = first.waitForResponse(r => new URL(r.url()).pathname === `/api/notebooks/${id}/sources` && r.request().method() === 'POST');
    await first.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
    expect((await added).status()).toBe(201);
    await expect(first.getByText(marker, { exact: true }).first()).toBeVisible();
    receipt.phase = 'logout';
    await first.goto('/');
    await first.locator('header button[aria-haspopup="menu"]').first().click();
    const signout = first.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signout' && r.request().method() === 'POST');
    await first.getByRole('menuitem', { name: /(?:^|\s)Sign out$/ }).click();
    expect((await signout).status()).toBe(200);
    await first.waitForURL(/\/auth/);
    expect((await read(first, '/api/user/profile')).status).toBe(401);
    cleanupPage = undefined;
    receipt.phase = 'fresh-login';
    const second = await fresh();
    await login(second, true);
    await login(second);
    cleanupPage = second;
    receipt.phase = 'fresh-login-source-persistence';
    const sources = await read(second, `/api/notebooks/${id}/sources`);
    expect(sources.status).toBe(200);
    expect(Array.isArray(sources.json) && sources.json.some((s: { title: string; content: string }) => s.title === marker && s.content === content)).toBe(true);
    await second.goto(`/notebook/${id}`);
    await expect(second.getByText(marker, { exact: true }).first()).toBeVisible();
    const anonymous = await fresh();
    await anonymous.goto('/auth?mode=cloud-login');
    expect([401, 403, 404]).toContain((await read(anonymous, `/api/notebooks/${id}/sources`)).status);
    receipt.phase = 'complete';
  } catch {
    // Locator errors can include filled secrets. Retain the sanitized phase only.
    throw new Error(`Shared-account diagnostic failed during ${receipt.phase}`);
  } finally {
    if (policy.ids().length && cleanupPage && !cleanupPage.isClosed()) {
      try {
        const id = policy.ids()[0];
        const status = await cleanupPage.evaluate(async id => (await fetch(`/api/notebooks/${id}`, { method: 'DELETE' })).status, id);
        const removed = await read(cleanupPage, `/api/notebooks/${id}`);
        receipt.cleanup = [200, 204].includes(status) && removed.status === 404 ? 'verified-deleted-new-notebook' : 'failed';
      } catch { receipt.cleanup = 'failed'; }
    } else if (policy.ids().length) receipt.cleanup = 'retained-new-qa-notebook-no-authenticated-session';
    receipt.createdNotebookIds = policy.ids();
    await testInfo.attach('shared-account-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
    await Promise.allSettled(contexts.map(context => context.close()));
  }
  expect(receipt.signupAttempts).toBe(0);
  expect(receipt.outOfScopeMutations).toBe(0);
  expect(receipt.cleanup).toBe('verified-deleted-new-notebook');
});
