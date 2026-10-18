import { acceptanceReceipt } from '../acceptance-contracts.mjs';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatDisplayTitle } from '../../src/lib/utils/displayTitle';

export interface LifecycleIdentity { email: string; displayName: string }
export const identity = (): LifecycleIdentity => ({ email: `lifecycle-${randomUUID()}@studypod.invalid`, displayName: `Lifecycle ${randomUUID()}` });

export function freshLifecycleContext(browser: Browser, baseURL: string | undefined, testInfo: TestInfo) {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  return browser.newContext({ baseURL, viewport, isMobile, hasTouch, serviceWorkers: 'block' });
}

// This suite cannot register an account on a cloud host, even if the config changes.
export function requireIsolatedLocal(baseURL?: string) {
  expect(process.env.STUDYPOD_FULL_ISOLATED, 'Disposable local database required').toBe('1');
  expect(baseURL, 'Explicit isolated target required').toBeTruthy();
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
  expect(Boolean(process.env.STUDYPOD_AUTH_PASSWORD), 'Synthetic test password required').toBe(true);
}

export async function fillAuth(page: Page, account: LifecycleIdentity, signup: boolean, password = process.env.STUDYPOD_AUTH_PASSWORD!) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(account.displayName);
  await page.getByLabel('Email Address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (signup) await page.locator('#tosAccepted').click();
}

export async function submitAuth(page: Page, signup: boolean) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/auth/${signup ? 'signup' : 'signin'}` && r.request().method() === 'POST');
  await page.getByRole('button', { name: signup ? 'Create Account' : 'Sign in', exact: true }).click();
  return response;
}

export async function authenticate(page: Page, account: LifecycleIdentity, signup: boolean) {
  await fillAuth(page, account, signup);
  expect((await submitAuth(page, signup)).status()).toBe(signup ? 201 : 200);
  await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
  const profile = await page.context().request.get('/api/user/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(account.email);
}

export async function createNotebook(page: Page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/notebooks' && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
  const result = await response;
  expect(result.status()).toBe(201);
  const notebook = await result.json() as { id: string; title: string };
  await page.waitForURL(url => url.pathname === `/notebook/${notebook.id}`);
  const title = formatDisplayTitle(notebook.title, 'Untitled notebook');
  await expect(page.locator('header').getByText(title, { exact: true })).toBeVisible();
  return { ...notebook, title };
}

export async function signOut(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').first().click();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signout' && r.request().method() === 'POST');
  await page.getByRole('menuitem', { name: /(?:^|\s)Sign out$/ }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(url => url.pathname === '/auth');
  expect((await page.context().request.get('/api/user/profile')).status()).toBe(401);
}

export function recordLifecycle(testInfo: TestInfo, receipt: Record<string, unknown>) {
  const directory = process.env.STUDYPOD_AUTH_ARTIFACTS;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  // Only phases, synthetic notebook IDs and outcome flags. No identity/password/cookies.
  writeFileSync(resolve(directory, `${testInfo.project.name}-${testInfo.title.split(':')[0]}.progress.json`), JSON.stringify(receipt, null, 2));
}

export async function attachLifecycle(testInfo: TestInfo, receipt: Record<string, unknown>) {
  recordLifecycle(testInfo, receipt);
  await testInfo.attach('sanitized-acceptance-receipt', {
    body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json',
  });
}
