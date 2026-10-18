import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { attachLifecycle, authenticate, createNotebook, fillAuth, freshLifecycleContext, identity, recordLifecycle, requireIsolatedLocal, signOut, submitAuth } from './helpers/accountLifecycle';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('account-lifecycle-invalid-login: rejected passwords and unknown accounts cannot enter a workspace', async ({ page, browser, baseURL }, testInfo) => {
  requireIsolatedLocal(baseURL);
  const account = identity();
  const receipt: Record<string, unknown> = { phase: 'signup', mockedAuthOrData: false };
  const contexts: BrowserContext[] = [];
  try {
    await authenticate(page, account, true);
    const notebook = await createNotebook(page);
    for (const attempt of [account, identity()]) {
      receipt.phase = attempt === account ? 'wrong-password' : 'unknown-email'; recordLifecycle(testInfo, receipt);
      const context = await freshLifecycleContext(browser, baseURL, testInfo); contexts.push(context);
      const rejected = await context.newPage();
      await fillAuth(rejected, attempt, false, `Incorrect-${randomUUID()}`);
      expect((await submitAuth(rejected, false)).status()).toBe(401);
      await expect(rejected.getByText('Invalid email or password', { exact: true }).first()).toBeVisible();
      expect(new URL(rejected.url()).pathname).toBe('/auth');
      await expect(rejected.getByRole('button', { name: 'Create notebook', exact: true })).toHaveCount(0);
      expect((await context.request.get('/api/user/profile')).status()).toBe(401);
      expect((await context.request.get(`/api/notebooks/${notebook.id}`)).status()).toBe(401);
      await context.close();
    }
    receipt.phase = 'passed'; receipt.failedAttemptsStayedAnonymous = true;
  } finally { await attachLifecycle(testInfo, receipt); await Promise.all(contexts.map(context => context.close())); }
});

test('account-lifecycle-duplicate-signup: duplicate email reports failure and leaves the original owner intact', async ({ page, browser, baseURL }, testInfo) => {
  requireIsolatedLocal(baseURL);
  const account = identity();
  const receipt: Record<string, unknown> = { phase: 'original-signup', mockedAuthOrData: false };
  const context = await freshLifecycleContext(browser, baseURL, testInfo);
  try {
    await authenticate(page, account, true);
    const notebook = await createNotebook(page);
    receipt.phase = 'duplicate-email'; recordLifecycle(testInfo, receipt);
    const duplicate = await context.newPage();
    // A different display name ensures we exercise duplicate EMAIL, not display-name validation.
    await fillAuth(duplicate, { ...account, displayName: identity().displayName }, true);
    const response = await submitAuth(duplicate, true);
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('USER_EXISTS');
    await expect(duplicate.getByText('Sign Up Failed', { exact: true }).first()).toBeVisible();
    await expect(duplicate.getByText('User already exists', { exact: true }).first()).toBeVisible();
    expect(new URL(duplicate.url()).pathname).toBe('/auth');
    expect((await context.request.get('/api/user/profile')).status()).toBe(401);
    receipt.phase = 'original-owner-fresh-login'; recordLifecycle(testInfo, receipt);
    await authenticate(duplicate, account, false);
    await duplicate.goto(`/notebook/${notebook.id}`);
    await expect(duplicate.locator('header').getByText(notebook.title, { exact: true })).toBeVisible();
    expect((await context.request.get(`/api/notebooks/${notebook.id}`)).status()).toBe(200);
    receipt.phase = 'passed'; receipt.originalOwnershipPreserved = true;
  } finally { await attachLifecycle(testInfo, receipt); await context.close(); }
});

test('account-lifecycle-notebook: rename, fresh login, foreign mutation denial, logout denial and owner delete', async ({ page, browser, baseURL }, testInfo) => {
  requireIsolatedLocal(baseURL);
  const owner = identity();
  const title = `Lifecycle notebook ${randomUUID()}`;
  const receipt: Record<string, unknown> = { phase: 'owner-signup', mockedAuthOrData: false };
  const contexts: BrowserContext[] = [];
  const fresh = async () => {
    const context = await freshLifecycleContext(browser, baseURL, testInfo); contexts.push(context);
    return { context, page: await context.newPage() };
  };
  try {
    await authenticate(page, owner, true);
    const notebook = await createNotebook(page);
    receipt.notebookId = notebook.id; receipt.phase = 'rename'; recordLifecycle(testInfo, receipt);
    await page.locator('header').getByText(notebook.title, { exact: true }).click();
    const editor = page.locator('header').getByRole('textbox');
    await expect(editor).toBeFocused(); await editor.fill(title);
    const renamed = page.waitForResponse(r => new URL(r.url()).pathname === `/api/notebooks/${notebook.id}` && r.request().method() === 'PUT');
    await editor.press('Enter'); expect((await renamed).status()).toBe(200);
    await expect(page.locator('header').getByText(title, { exact: true })).toBeVisible();
    await page.reload(); await expect(page.locator('header').getByText(title, { exact: true })).toBeVisible();
    receipt.phase = 'logout-protected-page'; recordLifecycle(testInfo, receipt);
    await signOut(page);
    expect((await page.context().request.get(`/api/notebooks/${notebook.id}`)).status()).toBe(401);
    expect((await page.context().request.put(`/api/notebooks/${notebook.id}`, { data: { title: 'Anonymous replacement' } })).status()).toBe(401);
    await page.goto(`/notebook/${notebook.id}`);
    await expect(page.locator('header').getByText(title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
    receipt.phase = 'fresh-owner-login'; recordLifecycle(testInfo, receipt);
    const restored = await fresh(); await authenticate(restored.page, owner, false);
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await restored.page.getByRole('heading', { name: title, exact: true }).click();
    await restored.page.waitForURL(url => url.pathname === `/notebook/${notebook.id}`);
    await expect(restored.page.locator('header').getByText(title, { exact: true })).toBeVisible();
    receipt.phase = 'foreign-isolation'; recordLifecycle(testInfo, receipt);
    const foreign = await fresh(); await authenticate(foreign.page, identity(), true);
    await expect(foreign.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    const foreignList = await foreign.context.request.get('/api/notebooks');
    expect(foreignList.status()).toBe(200);
    expect((await foreignList.json() as { id: string }[]).some(item => item.id === notebook.id)).toBe(false);
    const write = await foreign.context.request.put(`/api/notebooks/${notebook.id}`, { data: { title: 'Foreign replacement' } });
    expect(write.status()).toBe(404);
    const removal = await foreign.context.request.delete(`/api/notebooks/${notebook.id}`);
    expect(removal.status()).toBe(404);
    await foreign.page.goto(`/notebook/${notebook.id}`);
    await expect(foreign.page.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
    await expect(foreign.page.locator('header').getByText(title, { exact: true })).toHaveCount(0);
    const ownerRead = await restored.context.request.get(`/api/notebooks/${notebook.id}`);
    expect(ownerRead.status()).toBe(200); expect((await ownerRead.json()).title).toBe(title);
    receipt.phase = 'owner-delete-cancel-confirm'; recordLifecycle(testInfo, receipt);
    await restored.page.goto('/');
    // Keep a second notebook as a positive list-loading control after delete/re-login.
    const retained = await createNotebook(restored.page);
    await restored.page.goto('/');
    await restored.page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    const dialog = restored.page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this notebook?', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(new URL(restored.page.url()).pathname).toBe('/');
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(restored.page.getByRole('heading', { name: retained.title, exact: true })).toBeVisible();
    expect((await restored.context.request.get(`/api/notebooks/${notebook.id}`)).status()).toBe(200);
    await restored.page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    const removed = restored.page.waitForResponse(r => new URL(r.url()).pathname === `/api/notebooks/${notebook.id}` && r.request().method() === 'DELETE');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await restored.page.reload();
    await expect(restored.page.getByRole('heading', { name: retained.title, exact: true })).toBeVisible();
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    expect((await restored.context.request.get(`/api/notebooks/${notebook.id}`)).status()).toBe(404);
    receipt.phase = 'deleted-owner-fresh-login'; recordLifecycle(testInfo, receipt);
    const afterDelete = await fresh(); await authenticate(afterDelete.page, owner, false);
    await expect(afterDelete.page.getByRole('heading', { name: retained.title, exact: true })).toBeVisible();
    await expect(afterDelete.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    const remaining = await afterDelete.context.request.get('/api/notebooks');
    expect(remaining.status()).toBe(200);
    const remainingIds = (await remaining.json() as { id: string }[]).map(item => item.id);
    expect(remainingIds).toContain(retained.id); expect(remainingIds).not.toContain(notebook.id);
    await afterDelete.page.goto(`/notebook/${notebook.id}`);
    await expect(afterDelete.page.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
    receipt.phase = 'passed'; receipt.ownerLifecycleAndIsolation = true;
  } finally { await attachLifecycle(testInfo, receipt); await Promise.all(contexts.map(context => context.close())); }
});
