import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Source = { id: string; title: string; content: string; processingStatus: string; metadata?: string | { processingError?: { code?: string; stage?: string; retryable?: boolean } } };
type OutageReceipt = Record<string, unknown> & {
  stages: Record<string, { status: 'passed' | 'failed'; reason?: string }>;
  faults: { sourceId: string; stage: string; status: number | string; forwarded: boolean; extractedFact?: string }[];
  sourceIds: Record<string, string | undefined>;
  readableFacts: Record<string, string>;
};

// Deliberate pre-forward PUT fault injection, NOT a real provider outage.
// Auth, source POST/GET, native extraction and recovery use the actual isolated app.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' });
const fixture = (title: string, fact: string) => ({
  title, fact, name: `${title}.txt`, mimeType: 'text/plain',
  buffer: Buffer.from(`${title}\n\n${fact}\n\nThis fictional Cedar inventory is synthetic browser acceptance material. Each station maintains a daily ledger of its sample jars. The retained inventory statement above must remain readable after reloading the notebook. This exercise has no personal information and does not require generated chat or Studio output.`),
});
async function sourcesTab(page: Page) {
  const heading = page.getByRole('heading', { name: 'Sources', exact: true });
  const tab = page.getByRole('tab').filter({ hasText: /^\s*Sources\s*$/ });
  // Mobile initially shows Chat; wait for route mounting before choosing a pane.
  await expect.poll(async () => (await heading.isVisible()) || (await tab.isVisible())).toBe(true);
  if (!(await heading.isVisible())) {
    await expect(tab).toHaveAccessibleName('Sources');
    await tab.click();
  }
  await expect(heading).toBeVisible();
}
function sourceTitle(page: Page, title: string) {
  // Target the sidebar source title, excluding notebook headings and open viewer text.
  return page.locator('span.text-sm.font-medium').and(page.getByText(title, { exact: true }));
}
function card(page: Page, title: string) {
  return sourceTitle(page, title).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
}
async function upload(page: Page, file: ReturnType<typeof fixture>) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  const picker = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await picker).setFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await expect(dialog).toBeHidden();
}
async function saved(context: BrowserContext, notebookId: string): Promise<Source[]> {
  const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
  expect(response.status(), 'GET must remain real and available').toBe(200);
  const body = await response.json();
  const rows = body.sources || body;
  expect(Array.isArray(rows)).toBe(true);
  return rows;
}
async function readable(page: Page, file: ReturnType<typeof fixture>) {
  await sourcesTab(page);
  await sourceTitle(page, file.title).click();
  const viewer = page.getByTestId('source-content-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.prose').filter({ hasText: file.fact })).toBeVisible();
  await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}

for (const mode of ['content-and-failure-put', 'content-put-once'] as const) {
  test(`source-save-outage-${mode}: durable interruption and native replacement recovery`, async ({ page, context }, testInfo) => {
    test.setTimeout(240_000);
    expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
    expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
    expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
    expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
    expect(testInfo.project.use.baseURL, 'Never target shared ports or cloud').toBe('http://127.0.0.1:4182');
    const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
    await mkdir(artifactRoot, { recursive: true });
    const receipt: OutageReceipt = {
      scenario: `source-save-outage-${mode}`, phase: 'signup', outcome: 'failed', stages: {},
      faultBoundary: 'Intentional exact-owned-source PUT 503 before forwarding. Real auth/POST/GET/extraction/storage; no provider-response mocks or requested model generation.',
      faults: [], sourceIds: {}, readableFacts: {},
    };
    const persist = () => writeFile(join(artifactRoot, `${testInfo.project.name}-source-save-outage-${mode}.json`), JSON.stringify(receipt, null, 2));
    const failures: string[] = [];
    // Continue independent recovery assertions after the known current durable-state failure.
    // Never store raw assertion messages (which could contain signup field values).
    async function stage(name: string, action: () => Promise<void>) {
      receipt.phase = name; await persist();
      try { await test.step(name, action); receipt.stages[name] = { status: 'passed' }; }
      catch { failures.push(name); receipt.stages[name] = { status: 'failed', reason: 'Required acceptance assertion failed; see sanitized stage and source state.' }; }
      await persist();
    }
    const intact = fixture('Cedar intact ledger', 'Cedar intact station stores exactly 29 green sample jars.');
    const broken = fixture('Cedar interrupted ledger', 'Cedar interrupted station stores exactly 17 blue sample jars.');
    const replacement = fixture('Cedar replacement ledger', 'Cedar replacement station stores exactly 43 amber sample jars.');
    let notebookId = '';
    let targetId = '';
    let writesRestored = false;
    let contentRejected = false;
    let failureSeen = false;
    const routePattern = '**/api/notebooks/*/sources/*';
    try {
      const email = `save-outage-${randomUUID()}@studypod.invalid`;
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`Cedar outage ${randomUUID()}`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      const signup = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/signup');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      expect((await signup).status()).toBe(201);
      await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
      const profile = await context.request.get('/api/user/profile');
      expect(profile.status()).toBe(200);
      expect((await profile.json()).user.email).toBe(email);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.stages.signup = { status: 'passed' };
      receipt.phase = 'intact-native-upload'; await persist();
      await upload(page, intact);
      let intactId = '';
      await expect.poll(async () => {
        const row = (await saved(context, notebookId)).find(s => s.title === intact.name);
        intactId = row?.id || '';
        return !!row?.content?.includes(intact.fact) && ['completed', 'degraded'].includes(row.processingStatus);
      }, { timeout: 90_000 }).toBe(true);
      receipt.sourceIds.intact = intactId;
      await readable(page, intact);
      receipt.readableFacts.intact = intact.fact;
      receipt.stages['intact-native-upload'] = { status: 'passed' }; await persist();

      await page.route(routePattern, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const prefix = `/api/notebooks/${notebookId}/sources/`;
        if (writesRestored || request.method() !== 'PUT' || !path.startsWith(prefix)) return route.continue();
        const sourceId = path.slice(prefix.length);
        if (!sourceId || sourceId.includes('/')) return route.continue();
        const body = request.postDataJSON();
        if (!contentRejected && typeof body?.content === 'string' && body.content.includes(broken.fact)) {
          const ownerRow = (await saved(context, notebookId)).find(s => s.id === sourceId && s.title === broken.name);
          expect(ownerRow, 'Fault must target this newly uploaded owned file only').toBeTruthy();
          expect(ownerRow.processingStatus).toBe('uploading');
          expect(ownerRow.content || '').toBe('');
          targetId = sourceId; contentRejected = true;
          receipt.sourceIds.interrupted = sourceId;
          receipt.faults.push({ sourceId, stage: 'nonempty-content-save', status: 503, forwarded: false, extractedFact: broken.fact });
          await persist();
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic owned-source save outage' }) });
        }
        if (contentRejected && sourceId === targetId && body?.processing_status === 'failed') {
          failureSeen = true;
          receipt.faults.push({ sourceId, stage: 'failure-marker', status: mode === 'content-and-failure-put' ? 503 : 'forwarded-real-response', forwarded: mode === 'content-put-once' });
          await persist();
          if (mode === 'content-and-failure-put') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic owned-source failure-marker outage' }) });
        }
        return route.continue();
      });
      receipt.phase = 'injected-owned-content-save'; await persist();
      await upload(page, broken);
      await expect.poll(() => contentRejected && failureSeen, { timeout: 45_000 }).toBe(true);
      await expect.poll(async () => {
        const row = (await saved(context, notebookId)).find(s => s.id === targetId);
        return row && (mode === 'content-and-failure-put' || row.processingStatus === 'failed');
      }).toBeTruthy();
      const state = (await saved(context, notebookId)).find(s => s.id === targetId)!;
      expect(state.content || '').toBe('');
      if (mode === 'content-and-failure-put') expect(state.processingStatus).toBe('uploading');
      const metadata = typeof state.metadata === 'string' ? JSON.parse(state.metadata) : state.metadata;
      receipt.interruptedState = { sourceId: targetId, status: state.processingStatus, contentEmpty: true, failureCode: metadata?.processingError?.code || null, failureStage: metadata?.processingError?.stage || null };
      receipt.stages['injected-owned-content-save'] = { status: 'passed' }; await persist();

      const interruptionAlert = page.getByRole('alert').filter({
        has: page.getByText(`Upload interrupted: ${broken.name}`, { exact: true }),
      });
      async function recoveryDetails() {
        if (mode === 'content-and-failure-put') {
          // Both server writes failed: the owned, durable recovery hint is a
          // separate alert, while the authoritative source remains uploading.
          await expect(interruptionAlert).toHaveCount(1);
          await expect(interruptionAlert).toBeVisible();
          await expect(interruptionAlert).toContainText(/save.*confirmed/i);
          await expect(interruptionAlert).toContainText(/remove.*source.*add.*original file again/i);
          await expect(interruptionAlert.getByRole('button', {
            name: `Remove interrupted source ${broken.name}`, exact: true,
          })).toBeEnabled();
        } else {
          await expect(card(page, broken.title)).toContainText(/Failed|Interrupted/i);
          await expect(card(page, broken.title)).toContainText(/sav(?:e|ed|ing)|persist/i);
          await expect(card(page, broken.title)).toContainText(/retry|replace|reselect|add.*again/i);
        }
        await expect(card(page, broken.title).getByText('Ready', { exact: true })).toHaveCount(0);
      }
      await stage('durable-source-save-reason-before-reload', async () => {
        await sourcesTab(page);
        await recoveryDetails();
        if (mode === 'content-put-once') {
          expect(metadata?.processingError?.code, 'Saving extracted text must not be misclassified as extraction failure').toBe('SOURCE_SAVE_FAILED');
          expect(metadata?.processingError?.stage).toMatch(/sav|persist/i);
          expect(metadata?.processingError?.retryable).toBe(true);
        }
      });
      // A fresh document clears ephemeral toasts without racing their natural
      // disappearance; recovery must remain in the actual persisted UI.
      await page.reload(); await sourcesTab(page);
      await stage('persistent-interruption-after-reload', async () => {
        await recoveryDetails();
        if (mode === 'content-put-once') {
          const reloaded = (await saved(context, notebookId)).find(s => s.id === targetId);
          expect(reloaded?.processingStatus).toBe('failed');
          const reloadedMetadata = typeof reloaded?.metadata === 'string' ? JSON.parse(reloaded.metadata) : reloaded?.metadata;
          expect(reloadedMetadata?.processingError?.code).toBe('SOURCE_SAVE_FAILED');
          expect(reloadedMetadata?.processingError?.stage).toMatch(/sav|persist/i);
          expect(reloadedMetadata?.processingError?.retryable).toBe(true);
        } else {
          const reloaded = (await saved(context, notebookId)).find(s => s.id === targetId);
          expect(reloaded?.processingStatus).toBe('uploading');
          expect(reloaded?.content || '').toBe('');
        }
        await readable(page, intact);
      });
      writesRestored = true;
      await page.unroute(routePattern);
      await stage('actionable-owned-delete-and-native-readd', async () => {
        await sourcesTab(page);
        await expect(sourceTitle(page, broken.title)).toHaveCount(1);
        if (mode === 'content-and-failure-put') {
          await interruptionAlert.getByRole('button', {
            name: `Remove interrupted source ${broken.name}`, exact: true,
          }).click();
        } else {
          await sourceTitle(page, broken.title).click({ button: 'right' });
          const menu = page.getByRole('menu');
          await expect(menu).toBeVisible();
          // Match the visible label: decorative icon glyphs can enter the accessible name.
          const remove = menu.getByRole('menuitem').filter({ hasText: /^\s*Remove source\s*$/ });
          await expect(remove).toHaveCount(1);
          await expect(remove).toHaveAccessibleName('Remove source');
          await remove.click();
        }
        const confirmation = page.getByRole('alertdialog');
        await expect(confirmation).toContainText(`Delete ${broken.name}?`);
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect.poll(async () => (await saved(context, notebookId)).some(s => s.id === targetId)).toBe(false);
        await expect(interruptionAlert).toHaveCount(0);
        await upload(page, replacement);
        await expect.poll(async () => {
          const row = (await saved(context, notebookId)).find(s => s.title === replacement.name);
          receipt.sourceIds.replacement = row?.id;
          return !!row?.content?.includes(replacement.fact) && ['completed', 'degraded'].includes(row.processingStatus);
        }, { timeout: 90_000 }).toBe(true);
        await page.reload();
        const rows = await saved(context, notebookId);
        expect(rows).toHaveLength(2);
        expect(rows.find(s => s.id === intactId)?.content).toContain(intact.fact);
        expect(rows.find(s => s.id === receipt.sourceIds.replacement)?.content).toContain(replacement.fact);
        expect(rows.some(s => s.id === targetId)).toBe(false);
        await readable(page, intact); await readable(page, replacement);
        receipt.readableFacts.replacement = replacement.fact;
      });
      receipt.outcome = failures.length ? 'failed' : 'passed';
      receipt.phase = 'finished'; await persist();
      expect(failures, 'Every durable interruption and recovery acceptance stage must pass').toEqual([]);
    } finally {
      writesRestored = true;
      await page.unroute(routePattern);
      await persist();
      await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
    }
  });
}
