import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Source = { id: string; title: string; content: string; processingStatus: string };
const fixture = (title: string, count: number) => {
  const fact = `${title} stores exactly ${count} blue sample jars.`;
  return { title, fact, name: `${title}.txt`, mimeType: 'text/plain',
    buffer: Buffer.from(`${title}\n\n${fact}\n\nThis fictional Cedar inventory is synthetic browser acceptance material. The station keeps a daily inventory ledger. Its original file must finish uploading before a manual reload, and its inventory fact must remain readable afterwards. No personal information is included in this exercise.`) };
};
type Fixture = ReturnType<typeof fixture>;
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off' });

async function sourcesTab(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1100) {
    const tab = page.getByRole('tab', { name: 'Sources', exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}
async function upload(page: Page, files: Fixture[]) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await chooser).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(dialog).toBeHidden();
}
async function saved(context: BrowserContext, notebookId: string): Promise<Source[]> {
  const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  const rows = body.sources || body;
  expect(Array.isArray(rows)).toBe(true);
  return rows;
}
function title(page: Page, file: Fixture) {
  return page.locator('span.text-sm.font-medium').and(page.getByText(file.title, { exact: true }));
}

test('module-load-recovery: missing real viewer chunk protects native upload queue before manual reload', async ({ page, context }, testInfo) => {
  test.setTimeout(360_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  await mkdir(artifactRoot, { recursive: true });
  const receipt = {
    scenario: 'module-load-recovery', outcome: 'failed', phase: 'signup',
    boundary: 'Actual hashed lazy SourceContentViewer chunk is aborted. Exact native owned source content PUTs held before forwarding, then transparently continued. No fabricated assets, auth, source data, storage or provider responses. No generation requested.',
    stages: {} as Record<string, { status: string; reason?: string }>,
    missingChunks: [] as string[], heldSourceIds: [] as string[],
    sources: [] as { id: string; fileName: string; fact: string; status: string }[],
    queueProtected: false, automaticNavigations: 0, manualReload: false,
  };
  const persist = () => writeFile(join(artifactRoot, `${testInfo.project.name}-module-load-recovery.json`), JSON.stringify(receipt, null, 2));
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name; await persist();
    try { await test.step(name, action); receipt.stages[name] = { status: 'passed' }; }
    catch (error) {
      receipt.stages[name] = { status: 'failed', reason: 'Required visible or durable acceptance assertion failed.' };
      await persist(); throw error;
    }
    await persist();
  }
  const intact = fixture('Cedar module intact station', 29);
  const files = [fixture('Cedar module first station', 17), fixture('Cedar module second station', 31),
    fixture('Cedar module third station', 43), fixture('Cedar module queued station', 53)];
  let notebookId = '', retired = false, repairChunk = false, routeFailed = false;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const held = new Set<string>();
  const ids = new Map<string, string>();
  const sourcePattern = '**/api/notebooks/*/sources/*';
  const chunkPattern = '**/assets/SourceContentViewer-*.js';
  const sourceHandler = async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const prefix = `/api/notebooks/${notebookId}/sources/`;
    if (retired || request.method() !== 'PUT' || !path.startsWith(prefix)) return route.continue();
    const sourceId = path.slice(prefix.length);
    const body = request.postDataJSON();
    const file = files.find(f => typeof body?.content === 'string' && body.content.includes(f.fact));
    if (!file || !sourceId || sourceId.includes('/')) return route.continue();
    try {
      const row = (await saved(context, notebookId)).find(s => s.id === sourceId && s.title === file.name);
      expect(row).toBeTruthy(); expect(row.content || '').toBe('');
      expect(row.processingStatus).toBe('uploading');
      expect(held.has(sourceId)).toBe(false);
      held.add(sourceId); receipt.heldSourceIds = [...held]; await persist();
    } catch { routeFailed = true; }
    await hold;
    await route.continue();
  };
  const chunkHandler = async (route: Route) => {
    if (repairChunk) return route.continue();
    const path = new URL(route.request().url()).pathname;
    expect(path).toMatch(/^\/assets\/SourceContentViewer-[\w-]+\.js$/);
    expect(route.request().method()).toBe('GET');
    receipt.missingChunks.push(path.split('/').pop()!); await persist();
    await route.abort('failed');
  };
  try {
    await stage('real-owner-signup-and-notebook', async () => {
      const email = `module-${randomUUID()}@studypod.invalid`;
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`Cedar module ${randomUUID()}`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/signup');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      expect((await response).status()).toBe(201);
      const create = page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first();
      await expect(create).toBeVisible();
      const profile = await context.request.get('/api/user/profile');
      expect(profile.status()).toBe(200); expect((await profile.json()).user.email).toBe(email);
      await create.click(); await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
    });
    await stage('native-intact-source-with-viewer-not-yet-loaded', async () => {
      await upload(page, [intact]);
      await expect.poll(async () => {
        const row = (await saved(context, notebookId)).find(s => s.title === intact.name);
        if (row) ids.set(intact.name, row.id);
        return !!row?.content?.includes(intact.fact) && ['completed', 'degraded'].includes(row.processingStatus);
      }, { timeout: 120_000 }).toBe(true);
      await expect(title(page, intact)).toBeVisible();
      // Never open a viewer before installing the actual missing-module fault.
    });
    await page.route(sourcePattern, sourceHandler); await page.route(chunkPattern, chunkHandler);
    await stage('three-active-one-queued-native-files', async () => {
      await upload(page, files);
      await expect.poll(() => held.size, { timeout: 60_000 }).toBe(3);
      expect(routeFailed).toBe(false);
      const rows = await saved(context, notebookId);
      for (const file of files) {
        const row = rows.find(s => s.title === file.name); expect(row).toBeTruthy();
        ids.set(file.name, row.id); expect(row.content || '').toBe('');
        expect(row.processingStatus).toBe(file === files[3] ? 'pending' : 'uploading');
      }
      expect(held.has(ids.get(files[3].name)!)).toBe(false);
    });
    await stage('real-missing-module-and-visible-queue-guard', async () => {
      let navigations = 0;
      const observe = (frame: ReturnType<Page['mainFrame']>) => { if (frame === page.mainFrame()) navigations++; };
      page.on('framenavigated', observe);
      try {
        await title(page, intact).click();
        const fallback = page.getByRole('alert').filter({ hasText: 'Part of StudyPod could not load' });
        await expect(fallback).toBeVisible();
        expect(receipt.missingChunks.length, 'A genuine hashed module request must have failed').toBeGreaterThan(0);
        await expect(fallback.getByText(/Source uploads are still active or queued in this tab/)).toBeVisible();
        await expect(fallback.getByRole('button', { name: 'Reload StudyPod', exact: true })).toBeDisabled();
        expect(navigations, 'The fallback must not automatically reload the document').toBe(0);
        receipt.automaticNavigations = navigations; receipt.queueProtected = true;
        expect(held.size).toBe(3); expect(routeFailed).toBe(false);
      } finally { page.off('framenavigated', observe); }
    });
    await stage('finish-original-queue-before-allowing-explicit-reload', async () => {
      repairChunk = true; retired = true; release();
      await expect.poll(async () => {
        const rows = await saved(context, notebookId);
        receipt.sources = [intact, ...files].map(file => {
          const row = rows.find(s => s.id === ids.get(file.name));
          return { id: ids.get(file.name)!, fileName: file.name, fact: file.fact, status: row?.processingStatus || 'absent' };
        });
        await persist();
        return [intact, ...files].every(file => rows.some(s => s.id === ids.get(file.name) && s.content?.includes(file.fact) && ['completed', 'degraded'].includes(s.processingStatus)));
      }, { timeout: 180_000 }).toBe(true);
      expect(routeFailed).toBe(false);
      const button = page.getByRole('button', { name: 'Reload StudyPod', exact: true });
      await expect(button).toBeEnabled({ timeout: 15_000 });
      await expect(page.getByText(/Source uploads are still active or queued in this tab/)).toHaveCount(0);
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), button.click()]);
      expect(new URL(page.url()).pathname).toBe(`/notebook/${notebookId}`); receipt.manualReload = true;
    });
    await stage('repaired-real-viewer-all-native-facts-durable', async () => {
      for (const file of [intact, ...files]) {
        await sourcesTab(page); await title(page, file).click();
        const viewer = page.getByTestId('source-content-viewer');
        await expect(viewer).toBeVisible();
        await expect(viewer.locator('.prose').filter({ hasText: file.fact })).toBeVisible();
        await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
        await expect(viewer).toBeHidden();
        await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
      }
      await expect(page.getByRole('alert').filter({ hasText: 'Upload interrupted:' })).toHaveCount(0);
      const rows = await saved(context, notebookId); expect(rows).toHaveLength(5);
      for (const file of [intact, ...files]) expect(rows.find(s => s.id === ids.get(file.name))?.content).toContain(file.fact);
    });
    receipt.outcome = 'passed'; await persist();
  } finally {
    repairChunk = true; retired = true; release();
    await page.unroute(sourcePattern, sourceHandler); await page.unroute(chunkPattern, chunkHandler);
    await persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
