import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Cold real indexing-module delivery is held, never fulfilled with replacement data.
// All notebook/source creation, extraction, storage and deletion occur through the UI.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' });
const fixture = (index: number) => {
  const title = `Cedar guest queue station ${index}`;
  const fact = `${title} stores exactly ${[17, 23, 29, 31, 43][index - 1]} blue sample jars.`;
  return { title, fact, name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(
    `${title}\n\n${fact}\n\nThis fictional Cedar inventory is synthetic browser acceptance material. Each station maintains a daily ledger of its sample jars. The inventory statement must remain readable after reloading the notebook. This imaginary classroom exercise contains no personal information. The original file remains available to the tester for genuine native-picker replacement following interruption.`,
  ) };
};
type Fixture = ReturnType<typeof fixture>;
type Row = { id: string; notebook_id: string; title: string; content?: string; processing_status: string };
async function sourcesTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Sources', exact: true });
  const viewport = page.viewportSize();
  expect(viewport, 'The acceptance project must declare its viewport').not.toBeNull();
  // Notebook uses desktop columns at 1100px; smaller screens use mobile tabs.
  // Auto-retrying assertions also wait for useViewport's initial effect to settle.
  if (viewport!.width >= 1100) {
    await expect(tab).toHaveCount(0);
  } else {
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
}

async function returnToSourceList(page: Page) {
  const back = page.getByRole('button', { name: 'Back to source list', exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(back).toBeHidden();
  await sourcesTab(page);
}
async function dialog(page: Page) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  return page.getByRole('dialog', { name: 'Add sources', exact: true });
}
async function upload(page: Page, files: Fixture[]) {
  const add = await dialog(page);
  const picker = page.waitForEvent('filechooser');
  await add.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await picker).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(add).toBeHidden();
}
async function quota(page: Page, count: number) {
  const add = await dialog(page);
  await expect(add).toContainText(count === 0
    ? 'This guest notebook has reached its source limit. Sign in to add more sources.'
    : `You can add ${count} more source${count === 1 ? '' : 's'} to this guest notebook.`);
  await page.keyboard.press('Escape');
  await expect(add).toBeHidden();
}
const title = (page: Page, file: Fixture) => page.locator('span.text-sm.font-medium').and(page.getByText(file.title, { exact: true }));
const alert = (page: Page, file: Fixture) => page.getByRole('alert').filter({ has: page.getByText(`Upload interrupted: ${file.name}`, { exact: true }) });
async function saved(page: Page, notebookId: string): Promise<Row[]> {
  // Read-only observation of real UI-created storage; never preload or repair records.
  return page.evaluate(id => (JSON.parse(localStorage.getItem('sources') || '[]') as Row[]).filter(row => row.notebook_id === id), notebookId);
}

test('guest-upload-queue-reload: real five-file queue exposes lost pending originals and restores quota', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  const root = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  await mkdir(root, { recursive: true });
  const files = [1, 2, 3, 4, 5].map(fixture);
  const receipt: { scenario: string; outcome: string; phase: string; stages: string[]; heldResources: string[]; boundary: string } = {
    scenario: 'guest-upload-queue-reload', outcome: 'failed', phase: 'setup', stages: [], heldResources: [],
    boundary: 'Real cold documentProcessor JS delivery held before execution. First three TXT sources retain extracted content but indexing is incomplete; final two pending originals are lost from memory on reload. Same-context guest durability only; no model calls, source API mocks or storage injection.',
  };
  const persist = () => writeFile(join(root, `${testInfo.project.name}-guest-upload-queue-reload.json`), JSON.stringify(receipt, null, 2));
  const diagnostics: unknown[] = [];
  const assetLifecycle: { event: string; elapsedMs: number; path?: string; status?: number }[] = [];
  const diagnosticStart = Date.now();
  const recordLifecycle = (event: string, path?: string, status?: number) => {
    if (assetLifecycle.length === 120) assetLifecycle.shift();
    assetLifecycle.push({ event, elapsedMs: Date.now() - diagnosticStart, path, status });
  };
  const safeAssetPath = (url: string) => {
    const path = new URL(url).pathname;
    return /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path) ? path : undefined;
  };
  page.on('request', request => {
    const path = safeAssetPath(request.url());
    if (path) recordLifecycle('asset-request', path);
  });
  page.on('response', response => {
    const path = safeAssetPath(response.url());
    if (path) recordLifecycle('asset-response', path, response.status());
  });
  page.on('requestfinished', request => {
    const path = safeAssetPath(request.url());
    if (path) recordLifecycle('asset-finished', path);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) recordLifecycle('main-document-committed');
  });
  page.on('domcontentloaded', () => recordLifecycle('document-domcontentloaded'));
  page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.message }));
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    const path = safeAssetPath(request.url());
    if (path) recordLifecycle('asset-failed', path);
    if (url.pathname.startsWith('/assets/')) diagnostics.push({ type: 'asset-request-failed', path: url.pathname, error: request.failure()?.errorText });
  });
  const stage = async (name: string, action: () => Promise<void>) => {
    receipt.phase = name; await persist();
    await test.step(name, action); receipt.stages.push(name); await persist();
  };
  let releaseHold!: () => void;
  const hold = new Promise<void>(resolve => { releaseHold = resolve; });
  let retired = false;
  const chunkPattern = /\/assets\/documentProcessor-[^/?]+\.js(?:\?.*)?$/;
  const heldResources = new Set<string>();
  let notebookId = '', ownerId = '', key = '';
  const originalIds = new Map<string, string>();
  await page.route(chunkPattern, async route => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe('http://127.0.0.1:4182');
    expect(request.method()).toBe('GET');
    // Retirement applies only to requests entering the handler afterwards.
    // Reload may request this real chunk to render the new document; allow it.
    if (retired) {
      await route.continue();
      return;
    }
    heldResources.add(new URL(request.url()).pathname);
    await hold;
    // Release real delivery rather than aborting the shared module request.
    // Chromium may carry its in-flight module fetch across navigation; aborting
    // it after DOMContentLoaded can reject the new document's startup imports.
    try { await route.continue(); } catch { /* Reload may already cancel the old request. */ }
  });
  try {
    await stage('fresh-guest-owned-notebook', async () => {
      await page.goto('/');
      expect(heldResources.size, 'Indexing must be cold until the real upload').toBe(0);
      await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      ownerId = await page.evaluate(() => localStorage.getItem('guest_id') || '');
      expect(ownerId).toBeTruthy();
      const owned = await page.evaluate(({ id, owner }) => (JSON.parse(localStorage.getItem('notebooks') || '[]') as { id: string; user_id: string }[])
        .some(row => row.id === id && row.user_id === owner), { id: notebookId, owner: ownerId });
      expect(owned).toBe(true);
      key = `studypod:guest-upload-interruption:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(notebookId)}`;
      await quota(page, 5);
      expect(heldResources.size).toBe(0);
    });
    await stage('native-five-txt-three-indexing-two-pending', async () => {
      await upload(page, files);
      await expect.poll(() => heldResources.size, { timeout: 25_000 }).toBe(1);
      await expect.poll(async () => {
        const rows = await saved(page, notebookId);
        return files.every((file, index) => {
          const row = rows.find(row => row.title === file.name);
          return row && row.processing_status === (index < 3 ? 'processing' : 'pending')
            && (index < 3 ? row.content?.includes(file.fact) : !row.content);
        });
      }).toBe(true);
      const rows = await saved(page, notebookId);
      expect(rows).toHaveLength(5);
      for (const file of files) {
        originalIds.set(file.name, rows.find(row => row.title === file.name)!.id);
        await expect(title(page, file)).toBeVisible();
        await expect(alert(page, file)).toHaveCount(0);
      }
      const hints = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '[]'), key);
      expect(hints.map((hint: { sourceId: string }) => hint.sourceId).sort()).toEqual([...originalIds.values()].sort());
      expect(hints.map((hint: { fileName: string }) => hint.fileName).sort()).toEqual(files.map(file => file.name).sort());
      for (const hint of hints) expect(Object.keys(hint).sort()).toEqual(['fileName', 'occurredAt', 'reason', 'sourceId', 'stage']);
      await quota(page, 0);
      receipt.heldResources = [...heldResources];
    });
    await stage('reload-exact-five-actionable-hints-two-empty-pending', async () => {
      retired = true;
      // Old document is destroyed at commit; release before new startup completes.
      // Preserve a genuine reload and the lost in-memory pending originals.
      await page.reload({ waitUntil: 'commit' });
      recordLifecycle('reload-commit-barrier');
      releaseHold();
      recordLifecycle('held-module-released');
      await page.unroute(chunkPattern);
      await page.waitForLoadState('domcontentloaded');
      await sourcesTab(page);
      for (const file of files) {
        await expect(alert(page, file)).toBeVisible();
        await expect(alert(page, file)).toContainText('Remove this source and add the original file again.');
        await expect(alert(page, file).getByRole('button', { name: `Remove interrupted source ${file.name}`, exact: true })).toBeEnabled();
      }
      const rows = await saved(page, notebookId);
      for (const [index, file] of files.entries()) {
        const row = rows.find(row => row.id === originalIds.get(file.name));
        expect(row?.processing_status).toBe(index < 3 ? 'processing' : 'pending');
        if (index < 3) expect(row?.content).toContain(file.fact);
        else expect(row?.content || '').toBe('');
      }
      await quota(page, 0);
    });
    await stage('confirmed-pending-deletion-restores-durable-two-slots', async () => {
      for (const file of files.slice(3)) {
        await alert(page, file).getByRole('button', { name: `Remove interrupted source ${file.name}`, exact: true }).click();
        const confirmation = page.getByRole('alertdialog');
        await expect(confirmation).toContainText(`Delete ${file.name}?`);
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(title(page, file)).toHaveCount(0);
        await expect(alert(page, file)).toHaveCount(0);
      }
      await page.reload(); await sourcesTab(page);
      expect(await saved(page, notebookId)).toHaveLength(3);
      for (const file of files.slice(3)) await expect(alert(page, file)).toHaveCount(0);
      for (const file of files.slice(0, 3)) await expect(alert(page, file)).toBeVisible();
      const hints = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '[]'), key);
      expect(hints.map((hint: { sourceId: string }) => hint.sourceId).sort()).toEqual(files.slice(0, 3).map(file => originalIds.get(file.name)).sort());
      await quota(page, 2);
    });
    await stage('native-original-readd-ready-facts-survive-reload', async () => {
      await upload(page, files.slice(3));
      await expect.poll(async () => {
        const rows = await saved(page, notebookId);
        return files.slice(3).every(file => {
          const row = rows.find(row => row.title === file.name);
          return row && row.id !== originalIds.get(file.name) && row.content?.includes(file.fact)
            && ['completed', 'degraded'].includes(row.processing_status);
        });
      }, { timeout: 90_000 }).toBe(true);
      await page.reload(); await sourcesTab(page);
      expect(await saved(page, notebookId)).toHaveLength(5);
      for (const file of files.slice(3)) {
        await expect(alert(page, file)).toHaveCount(0);
        const card = title(page, file).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
        await expect(card.getByText('Ready', { exact: true })).toBeVisible();
        await title(page, file).click();
        await expect(page.locator('.prose').filter({ hasText: file.fact }).first()).toBeVisible();
        await returnToSourceList(page);
      }
      for (const file of files.slice(0, 3)) await expect(alert(page, file)).toBeVisible();
      await quota(page, 0);
    });
    receipt.outcome = 'passed'; receipt.phase = 'finished';
  } finally {
    retired = true; releaseHold();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    Object.assign(receipt, { diagnostics, finalPage: await page.evaluate(() => ({ path: location.pathname, headings: [...document.querySelectorAll('h1,h2,h3,[role="tab"]')].map(node => node.textContent), status: [...document.querySelectorAll('[role="alert"],[role="status"]')].map(node => node.textContent) })).catch(() => ({ unavailable: true })) });
    if (receipt.outcome !== 'passed') {
      // Public diagnostics expose structural state and known asset paths only.
      // No body text, notebook/owner IDs, storage, query strings or credentials.
      const documentState = await page.evaluate(() => ({
        readyState: document.readyState,
        rootPresent: !!document.getElementById('root'),
        rootChildCount: document.getElementById('root')?.childElementCount ?? 0,
        headingCount: document.querySelectorAll('h1,h2,h3').length,
        tabCount: document.querySelectorAll('[role="tab"]').length,
        alertCount: document.querySelectorAll('[role="alert"]').length,
      })).catch(() => ({ unavailable: true }));
      await testInfo.attach('guest-queue-navigation-diagnostics-public', {
        body: Buffer.from(JSON.stringify({ phase: receipt.phase, documentState, assetLifecycle })),
        contentType: 'application/json',
      });
    }
    await persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
