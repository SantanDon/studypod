import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Request, type Response, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Source = { id: string; title: string; content: string; processingStatus: string };
type InterruptionReceipt = { sourceId: string; fileName: string };
type QueueReceipt = Record<string, unknown> & {
  stages: Record<string, { status: 'passed' | 'failed'; reason?: string }>;
  faults: { sourceId: string; fileName: string; stage: string; status: string; forwarded: boolean }[];
  sourceIds: Record<string, string>;
  readableFacts: Record<string, string>;
};

// Intentional pre-forward request holds isolate lost File-memory from provider failures.
// Real signup, native picker/extraction, source POST/GET/DELETE and replacement pipeline.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' });
const fixture = (title: string, fact: string) => ({
  title, fact, name: `${title}.txt`, mimeType: 'text/plain',
  buffer: Buffer.from(`${title}\n\n${fact}\n\nThis fictional Cedar inventory is synthetic browser acceptance material. Each station maintains a daily ledger of its sample jars. The retained inventory statement above must remain readable after reloading the notebook. This exercise contains no personal information. The original inventory file is available to the tester for a genuine native-picker replacement after an interrupted upload.`),
});
type Fixture = ReturnType<typeof fixture>;
async function sourcesTab(page: Page) {
  const tab = page.getByRole('tab', { name: /(?:^|\s)Sources$/ });
  await expect(tab.or(page.getByRole('heading', { name: 'Sources', exact: true })).first()).toBeVisible();
  if (await tab.count()) await tab.click();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}
async function upload(page: Page, files: Fixture[]) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  const picker = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await picker).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(dialog).toBeHidden();
}
async function saved(context: BrowserContext, notebookId: string): Promise<Source[]> {
  const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
  expect(response.status(), 'Real owned-source GET must work during the request hold').toBe(200);
  const body = await response.json();
  const rows = body.sources || body;
  expect(Array.isArray(rows)).toBe(true);
  return rows;
}
function sourceTitle(page: Page, file: Fixture) {
  // SourcesSidebar renders the clickable card title in this span; exclude notebook headings.
  return page.locator('span.text-sm.font-medium').and(page.getByText(file.title, { exact: true }));
}
async function readable(page: Page, file: Fixture) {
  await sourcesTab(page);
  await sourceTitle(page, file).click();
  const viewer = page.getByTestId('source-content-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.prose').filter({ hasText: file.fact })).toBeVisible();
  await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}
function interruption(page: Page, file: Fixture) {
  return page.getByRole('alert').filter({ has: page.getByText(`Upload interrupted: ${file.name}`, { exact: true }) });
}

test('upload-queue-reload: acknowledged four-file queue recovers after document loss', async ({ page, context }, testInfo) => {
  test.setTimeout(360_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(testInfo.project.use.baseURL, 'Only dedicated local acceptance port is authorized').toBe('http://127.0.0.1:4182');
  const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  await mkdir(artifactRoot, { recursive: true });
  const receipt: QueueReceipt = {
    scenario: 'upload-queue-reload', outcome: 'failed', phase: 'signup', stages: {}, faults: [], sourceIds: {}, readableFacts: {},
    boundary: 'Intentional exact-owned-source nonempty-content PUT holds before forwarding, then old-document abort. No auth/model/storage mocks. Historical processing and completed restoration are explicitly seeded through real authenticated storage; native replacement runs the real pipeline.',
  };
  const persist = () => writeFile(join(artifactRoot, `${testInfo.project.name}-upload-queue-reload.json`), JSON.stringify(receipt, null, 2));
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name; await persist();
    try { await test.step(name, action); receipt.stages[name] = { status: 'passed' }; }
    catch (error) {
      receipt.stages[name] = { status: 'failed', reason: 'Required acceptance assertion failed; no dependent stage was treated as passing.' };
      await persist(); throw error;
    }
    await persist();
  }
  const intact = fixture('Cedar queue intact ledger', 'Cedar intact station stores exactly 29 green sample jars.');
  const historical = fixture('Cedar historical processing ledger', 'Cedar historical station stores exactly 61 silver sample jars.');
  const files = [
    fixture('Cedar queue first ledger', 'Cedar first station stores exactly 17 blue sample jars.'),
    fixture('Cedar queue second ledger', 'Cedar second station stores exactly 31 violet sample jars.'),
    fixture('Cedar queue third ledger', 'Cedar third station stores exactly 43 amber sample jars.'),
    fixture('Cedar queue fourth ledger', 'Cedar fourth station stores exactly 53 red sample jars.'),
  ];
  let notebookId = '', ownerId = '', intactId = '', historicalId = '';
  const originalIds = new Map<string, string>();
  // Extracted payloads stay in memory and never enter an acceptance receipt.
  const held = new Map<string, { file: Fixture; body: Record<string, unknown> }>();
  let releaseHold!: () => void;
  const hold = new Promise<void>(resolve => { releaseHold = resolve; });
  let retired = false, routeFailed = false;
  const routePattern = '**/api/notebooks/*/sources/*';
  try {
    await stage('real-isolated-signup-and-notebook', async () => {
      const email = `queue-reload-${randomUUID()}@studypod.invalid`;
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`Cedar queue ${randomUUID()}`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      const signup = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/signup');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      expect((await signup).status()).toBe(201);
      await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
      const profile = await context.request.get('/api/user/profile');
      expect(profile.status()).toBe(200);
      const user = (await profile.json()).user;
      expect(user.email).toBe(email); ownerId = user.id;
      expect(ownerId).toBeTruthy();
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
    });
    await stage('real-intact-upload-and-explicit-historical-fixture', async () => {
      await upload(page, [intact]);
      await expect.poll(async () => {
        const row = (await saved(context, notebookId)).find(s => s.title === intact.name);
        intactId = row?.id || '';
        return !!row?.content?.includes(intact.fact) && ['completed', 'degraded'].includes(row.processingStatus);
      }, { timeout: 90_000 }).toBe(true);
      await readable(page, intact);
      receipt.sourceIds.intact = intactId; receipt.readableFacts.intact = intact.fact;
      // Historical processing source has no native-upload receipt; it must not be labeled interrupted.
      const seed = await context.request.post(`/api/notebooks/${notebookId}/sources`, { data: {
        title: historical.name, type: 'text', content: historical.buffer.toString(), processing_status: 'processing',
        metadata: { fileName: historical.name, fileType: historical.mimeType },
      } });
      expect(seed.status()).toBe(201);
      const row = (await saved(context, notebookId)).find(s => s.title === historical.name);
      expect(row?.processingStatus).toBe('processing'); expect(row?.content).toContain(historical.fact);
      historicalId = row.id; receipt.sourceIds.historicalFixture = historicalId;
      await page.reload(); await sourcesTab(page);
      await expect(interruption(page, historical)).toHaveCount(0);
    });
    await page.route(routePattern, async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const prefix = `/api/notebooks/${notebookId}/sources/`;
      if (retired || request.method() !== 'PUT' || !path.startsWith(prefix)) return route.continue();
      const sourceId = path.slice(prefix.length);
      if (!sourceId || sourceId.includes('/')) return route.continue();
      const body = request.postDataJSON();
      const file = files.find(f => typeof body?.content === 'string' && body.content.includes(f.fact));
      if (!file) return route.continue();
      try {
        const row = (await saved(context, notebookId)).find(s => s.id === sourceId && s.title === file.name);
        expect(row, 'Hold only this test notebook acknowledged native source').toBeTruthy();
        expect(row.processingStatus).toBe('uploading'); expect(row.content || '').toBe('');
        expect(held.has(sourceId), 'Only the first content save is held').toBe(false);
        held.set(sourceId, { file, body });
        receipt.faults.push({ sourceId, fileName: file.name, stage: 'nonempty-content-save', status: 'held-before-forward', forwarded: false });
        await persist();
      } catch { routeFailed = true; }
      await hold;
      // Old document has already been destroyed. Do not reject while its catch can write a failure marker.
      try { await route.abort('aborted'); } catch { /* Old document may have canceled the request itself. */ }
    });
    await stage('four-acknowledged-three-held-one-queued-no-false-interruption', async () => {
      await upload(page, files);
      await expect.poll(() => held.size, { timeout: 25_000 }).toBe(3);
      expect(routeFailed).toBe(false);
      const rows = await saved(context, notebookId);
      for (const [index, file] of files.entries()) {
        const row = rows.find(s => s.title === file.name);
        expect(row, `${file.name} must be acknowledged before queue execution`).toBeTruthy();
        originalIds.set(file.name, row.id); receipt.sourceIds[file.name] = row.id;
        expect(row.content || '').toBe('');
        expect(row.processingStatus).toBe(index < 3 ? 'uploading' : 'pending');
        expect(held.has(row.id)).toBe(index < 3);
        await expect(sourceTitle(page, file)).toBeVisible();
      }
      const receipts: InterruptionReceipt[] = await page.evaluate(({ ownerId, notebookId }) => JSON.parse(localStorage.getItem(
        `studypod:upload-interruption:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(notebookId)}`,
      ) || '[]'), { ownerId, notebookId });
      expect(receipts.map(r => r.sourceId).sort()).toEqual([...originalIds.values()].sort());
      expect(receipts.map(r => r.fileName).sort()).toEqual(files.map(f => f.name).sort());
      for (const file of [...files, historical, intact]) await expect(interruption(page, file)).toHaveCount(0);
      receipt.acknowledgedQueue = files.map(file => ({ sourceId: originalIds.get(file.name), fileName: file.name,
        status: rows.find(s => s.title === file.name).processingStatus, contentEmpty: true }));
    });
    await stage('reload-loses-file-memory-and-exposes-four-exact-recovery-actions', async () => {
      // Passive, allowlisted telemetry only: never retain URLs, bodies, headers or raw errors.
      // Do not add prerequisite waits here: this checkpoint must preserve the reload race.
      const startedAt = Date.now();
      const requestTimes = new Map<Request, number>();
      const network: { endpoint: string; status: number | null; elapsedMs: number; requestMs: number | null; failed: boolean }[] = [];
      const endpointFor = (request: Request) => {
        const path = new URL(request.url()).pathname;
        return ({ '/api/user/profile': 'profile', '/api/auth/refresh': 'refresh', '/api/notebooks': 'notebook-list' } as Record<string, string>)[path];
      };
      const onRequest = (request: Request) => { if (endpointFor(request)) requestTimes.set(request, Date.now()); };
      const record = (request: Request, status: number | null, failed: boolean) => {
        const endpoint = endpointFor(request);
        if (!endpoint || network.length >= 40) return;
        const now = Date.now(), requestAt = requestTimes.get(request);
        network.push({ endpoint, status, elapsedMs: now - startedAt, requestMs: requestAt === undefined ? null : now - requestAt, failed });
        requestTimes.delete(request);
      };
      const onResponse = (response: Response) => record(response.request(), response.status(), false);
      const onFailed = (request: Request) => record(request, null, true);
      page.on('request', onRequest);
      page.on('response', onResponse);
      page.on('requestfailed', onFailed);
      const diagnostics: Record<string, unknown> = { network, responseLimit: 40, viewport: page.viewportSize() };
      receipt.forcedReloadDiagnostics = diagnostics;
      try {
        retired = true;
        await page.reload({ waitUntil: 'domcontentloaded' });
        releaseHold();
        // Keep retired routes transparent while the cold document hydrates.
        // Final cleanup removes them after the journey, not during auth fetches.
        await sourcesTab(page);
        for (const file of files) {
          await expect(interruption(page, file)).toBeVisible();
          await expect(interruption(page, file)).toContainText('remove this source and add the original file again');
          await expect(interruption(page, file).getByRole('button', { name: `Remove interrupted source ${file.name}`, exact: true })).toBeEnabled();
        }
        for (const file of [historical, intact]) await expect(interruption(page, file)).toHaveCount(0);
        const rows = await saved(context, notebookId);
        for (const [index, file] of files.entries()) {
          const row = rows.find(s => s.id === originalIds.get(file.name));
          expect(row?.processingStatus).toBe(index < 3 ? 'uploading' : 'pending');
          expect(row?.content || '').toBe('');
        }
        receipt.faults.forEach(fault => { fault.status = 'old-document-aborted-after-reload'; });
        } catch (error) {
        // Immediate visibility probes only after failure; no snapshots or text extraction.
        const visible = (locator: Locator) => locator.first().isVisible().catch(() => false);
        try {
          const path = new URL(page.url()).pathname;
          diagnostics.route = /^\/notebook\/[^/]+$/.test(path) ? 'notebook-detail' : path === '/auth' ? 'auth' : 'other';
          diagnostics.visible = Object.fromEntries(await Promise.all(Object.entries({
            sourcesTab: page.getByRole('tab', { name: /(?:^|\s)Sources$/ }),
            sourcesHeading: page.getByRole('heading', { name: 'Sources', exact: true }),
            notebookLoading: page.getByText('Loading notebook...', { exact: true }),
            notebookNotFound: page.getByRole('heading', { name: 'Notebook Not Found', exact: true }),
            routeLoading: page.getByText('Loading StudyPod…', { exact: true }),
            errorFallback: page.getByText('Something went wrong', { exact: true }),
            cloudAuthForm: page.getByLabel('Email Address', { exact: true }),
            encryptionUnlock: page.getByRole('button', { name: 'Unlock', exact: true }),
          }).map(async ([name, locator]) => [name, await visible(locator)])));
        } catch { diagnostics.visibilityProbeUnavailable = true; }
        throw error;
      } finally {
        diagnostics.elapsedMs = Date.now() - startedAt;
        diagnostics.pendingEndpoints = [...requestTimes.keys()].map(endpointFor).filter(Boolean).slice(0, 40);
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('requestfailed', onFailed);
      }
    });
    await stage('real-completed-server-record-clears-only-its-hint', async () => {
      const file = files[0], sourceId = originalIds.get(file.name)!;
      const payload = held.get(sourceId)!.body;
      // Explicit restoration fixture: real storage write, not claimed as successful provider processing.
      const restored = await context.request.put(`/api/notebooks/${notebookId}/sources/${sourceId}`, {
        data: { ...payload, processing_status: 'completed' },
      });
      expect(restored.status()).toBe(200);
      const row = (await saved(context, notebookId)).find(s => s.id === sourceId);
      expect(row?.processingStatus).toBe('completed'); expect(row?.content).toContain(file.fact);
      await page.reload(); await sourcesTab(page);
      await expect(interruption(page, file)).toHaveCount(0);
      for (const remaining of files.slice(1)) await expect(interruption(page, remaining)).toBeVisible();
      for (const other of [historical, intact]) await expect(interruption(page, other)).toHaveCount(0);
      await readable(page, file);
      receipt.readableFacts.restoredFixture = file.fact;
    });
    await stage('owned-ui-delete-and-native-original-file-readd', async () => {
      for (const file of files.slice(1)) {
        await sourcesTab(page);
        await interruption(page, file).getByRole('button', { name: `Remove interrupted source ${file.name}`, exact: true }).click();
        const confirmation = page.getByRole('alertdialog');
        await expect(confirmation).toContainText(`Delete ${file.name}?`);
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect.poll(async () => (await saved(context, notebookId)).some(s => s.id === originalIds.get(file.name))).toBe(false);
        await expect(interruption(page, file)).toHaveCount(0);
      }
      await upload(page, files.slice(1));
      await expect.poll(async () => {
        const rows = await saved(context, notebookId);
        return files.slice(1).every(file => {
          const row = rows.find(s => s.title === file.name);
          return row && row.id !== originalIds.get(file.name) && row.content?.includes(file.fact) && ['completed', 'degraded'].includes(row.processingStatus);
        });
      }, { timeout: 120_000 }).toBe(true);
      await page.reload(); await sourcesTab(page);
      const rows = await saved(context, notebookId);
      expect(rows).toHaveLength(6);
      expect(rows.find(s => s.id === intactId)?.content).toContain(intact.fact);
      expect(rows.find(s => s.id === historicalId)?.processingStatus).toBe('processing');
      expect(rows.find(s => s.id === historicalId)?.content).toContain(historical.fact);
      for (const file of [...files, intact, historical]) {
        await expect(interruption(page, file)).toHaveCount(0);
        await readable(page, file);
        receipt.readableFacts[file.name] = file.fact;
      }
      receipt.replacements = files.slice(1).map(file => ({ fileName: file.name, oldSourceId: originalIds.get(file.name),
        sourceId: rows.find(s => s.title === file.name).id, status: rows.find(s => s.title === file.name).processingStatus }));
    });
    receipt.outcome = 'passed'; receipt.phase = 'finished'; await persist();
  } finally {
    retired = true; releaseHold();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
