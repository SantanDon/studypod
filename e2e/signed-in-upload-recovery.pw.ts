import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Real native uploads, extraction and owner sessions. No intercepted responses or injected storage.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off' });
type Fixture = { name: string; title: string; fact: string; mimeType: string; buffer: Buffer };
type Source = { id: string; title: string; content: string; processingStatus?: string; processing_status?: string; metadata?: unknown };
type FailureMetadata = { fileName?: string; fileType?: string; processingStage?: string; processingError: { code: string; stage: string; retryable: boolean; message: string } };
type RecoveryReceipt = Record<string, unknown> & { stages: { name: string; status: 'passed' | 'failed' }[] };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const textFixture = (title: string, fact: string): Fixture => ({
  title, fact, name: `${title}.txt`, mimeType: 'text/plain',
  buffer: Buffer.from(`${title}\n\n${fact}\n\nThis fictional Cedar training notebook contains synthetic inventory records for browser acceptance testing. The station keeper records each jar before the morning inspection. These records belong to an imaginary classroom exercise and contain no personal information. The inventory statement above is the retained fact that a reader must be able to reopen after refreshing the notebook.`, 'utf8'),
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
async function upload(page: Page, fixtures: Fixture[]) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await chooser).setFiles(fixtures.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(dialog).toBeHidden();
}
async function openFact(page: Page, fixture: Fixture) {
  await sourcesTab(page);
  await expect(card(page, fixture.title).getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await sourceTitle(page, fixture.title).click();
  const viewer = page.getByTestId('source-content-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.prose').filter({ hasText: fixture.fact })).toBeVisible();
  await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}
async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Cedar recovery ${randomUUID()}`);
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
  if (signup) await page.locator('#tosAccepted').click();
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/auth/${signup ? 'signup' : 'signin'}`));
  await page.getByRole('button', { name: signup ? 'Create Account' : 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(signup ? 201 : 200);
  await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
  const profile = await page.context().request.get('/api/user/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(email);
}
async function savedSources(context: BrowserContext, notebookId: string): Promise<Source[]> {
  const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  const sources = body.sources || body;
  expect(Array.isArray(sources)).toBe(true);
  return sources;
}
function metadata(source: Source): FailureMetadata {
  return typeof source.metadata === 'string' ? JSON.parse(source.metadata) : (source.metadata || {}) as FailureMetadata;
}

test('signed-in-upload-recovery: durable extraction failure, deletion, replacement and fresh-owner reopen', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(360_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  const email = `recovery-${randomUUID()}@studypod.invalid`;
  const originals = [17, 23, 29, 31].map((jars, index) => textFixture(
    `Cedar owner station ${index + 1}`, `Cedar owner station ${index + 1} stores exactly ${jars} blue sample jars.`,
  ));
  const broken: Fixture = { name: 'Cedar corrupt owner archive.docx', title: 'Cedar corrupt owner archive', fact: '',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('Synthetic corrupt DOCX fixture. This is deliberately not a ZIP archive.', 'utf8') };
  const replacement = textFixture('Cedar owner replacement', 'Cedar owner replacement stores exactly 43 amber sample jars.');
  const receipt: RecoveryReceipt = { scenario: 'signed-in-upload-recovery', project: testInfo.project.name, outcome: 'failed', stages: [],
    boundary: 'Synthetic data; native picker and UI signup/signin/signout; read-only server confirmation. Corrupt DOCX extraction failure only, not API outage recovery. No guest quota assertion, storage injection, auth API bypass or mocked responses.' };
  const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  await mkdir(artifactRoot, { recursive: true });
  const persist = () => writeFile(join(artifactRoot, `signed-in-upload-recovery-${testInfo.project.name}.json`), JSON.stringify(receipt, null, 2));
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name; await persist();
    try { await test.step(name, action); receipt.stages.push({ name, status: 'passed' }); }
    catch (error) { receipt.stages.push({ name, status: 'failed' }); throw error; }
    finally { await persist(); }
  }
  let notebookId = '';
  let failedId = '';
  let durableError = '';
  let originalSnapshot: Source[] = [];
  let failedMetadata: FailureMetadata;
  async function verifyOriginals(activeContext: BrowserContext, withReplacement: boolean) {
    const rows = await savedSources(activeContext, notebookId);
    expect(rows).toHaveLength(withReplacement ? 5 : 4);
    for (const original of originalSnapshot) {
      const retained = rows.find(row => row.id === original.id);
      expect(retained, `Original source ${original.title} remains saved`).toBeTruthy();
      expect(retained!.content).toBe(original.content);
      expect(retained!.title).toBe(original.title);
    }
    expect(rows.some(row => row.id === failedId)).toBe(false);
    if (withReplacement) expect(rows.find(row => row.title === replacement.name || row.title === replacement.title)?.content).toContain(replacement.fact);
    return rows;
  }
  async function verifyFailure(activePage: Page, activeContext: BrowserContext) {
    await sourcesTab(activePage);
    const failed = card(activePage, broken.title);
    await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
    await expect(failed.locator('p')).toHaveText(durableError);
    await expect(failed.getByText(/^(Ready|Processing|Chat ready)$/)).toHaveCount(0);
    const saved = (await savedSources(activeContext, notebookId)).find(row => row.id === failedId)!;
    expect(saved).toBeTruthy();
    expect(saved.processingStatus || saved.processing_status).toBe('failed');
    expect(metadata(saved)).toEqual(failedMetadata);
  }
  try {
    await stage('ui-signup-and-owner-notebook', async () => {
      await authenticate(page, email, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
    });
    await stage('four-native-txt-uploads-and-original-snapshot', async () => {
      await upload(page, originals);
      for (const fixture of originals) await openFact(page, fixture);
      originalSnapshot = await savedSources(context, notebookId);
      expect(originalSnapshot).toHaveLength(4);
      for (const fixture of originals) expect(originalSnapshot.find(row => row.title === fixture.name || row.title === fixture.title)?.content).toContain(fixture.fact);
      receipt.originals = originalSnapshot.map(row => ({ id: row.id, title: row.title, contentSha256: hash(row.content) }));
    });
    await stage('real-corrupt-docx-failure-and-saved-metadata', async () => {
      await upload(page, [broken]);
      const failed = card(page, broken.title);
      await expect(failed.getByText('Failed', { exact: true })).toBeVisible({ timeout: 90_000 });
      await expect(failed.locator('p')).toContainText(/extracting:/i);
      await expect(failed.locator('p')).toContainText(/DOCX|zip|central directory/i);
      durableError = await failed.locator('p').innerText();
      const rows = await savedSources(context, notebookId);
      expect(rows).toHaveLength(5);
      const saved = rows.find(row => row.title === broken.name || row.title === broken.title)!;
      expect(saved).toBeTruthy(); failedId = saved.id; failedMetadata = metadata(saved);
      expect(failedMetadata.fileName).toBe(broken.name);
      expect(failedMetadata.fileType).toBe(broken.mimeType);
      expect(failedMetadata.processingStage).toBe('extracting');
      expect(failedMetadata.processingError).toMatchObject({ code: 'SOURCE_EXTRACTION_FAILED', stage: 'extracting', retryable: true });
      expect(failedMetadata.processingError.message).toMatch(/DOCX|zip|central directory/i);
      receipt.failure = { id: failedId, visibleDetail: durableError, code: failedMetadata.processingError.code, stage: failedMetadata.processingError.stage, retryable: failedMetadata.processingError.retryable };
      // Reload clears transient notifications while preserving server-backed failure details.
      await page.reload(); await verifyFailure(page, context);
    });
    await stage('ui-logout-login-retains-failure-and-original-facts', async () => {
      await page.goto('/');
      await page.locator('header button[aria-haspopup="menu"]').first().click();
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signout' && r.request().method() === 'POST');
      await page.getByRole('menuitem', { name: /(?:^|\s)Sign out$/ }).click();
      expect((await response).status()).toBe(200); await page.waitForURL(/\/auth/);
      expect((await context.request.get('/api/user/profile')).status()).toBe(401);
      await authenticate(page, email, false); await page.goto(`/notebook/${notebookId}`);
      await verifyFailure(page, context);
      for (const fixture of originals) await openFact(page, fixture);
    });
    await stage('ui-delete-failed-source-and-server-confirmation', async () => {
      await expect(sourceTitle(page, broken.title)).toHaveCount(1);
      await sourceTitle(page, broken.title).click({ button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      // Match the visible label: decorative icon glyphs can enter the accessible name.
      const remove = menu.getByRole('menuitem').filter({ hasText: /^\s*Remove source\s*$/ });
      await expect(remove).toHaveCount(1);
      await expect(remove).toHaveAccessibleName('Remove source');
      await remove.click();
      const confirmation = page.getByRole('alertdialog');
      await expect(confirmation).toContainText(`Delete ${broken.name}?`);
      await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(sourceTitle(page, broken.title)).toHaveCount(0);
      await page.reload(); await sourcesTab(page);
      await expect(sourceTitle(page, broken.title)).toHaveCount(0);
      await verifyOriginals(context, false);
    });
    await stage('native-replacement-and-five-facts-after-reload', async () => {
      await upload(page, [replacement]); await openFact(page, replacement); await page.reload();
      for (const fixture of [...originals, replacement]) await openFact(page, fixture);
      await verifyOriginals(context, true);
    });
    await stage('fresh-browser-same-owner-reopens-all-facts', async () => {
      const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
      try {
        expect((await fresh.request.get('/api/user/profile')).status()).toBe(401);
        const freshPage = await fresh.newPage(); await authenticate(freshPage, email, false);
        await freshPage.goto(`/notebook/${notebookId}`);
        for (const fixture of [...originals, replacement]) await openFact(freshPage, fixture);
        await expect(sourceTitle(freshPage, broken.title)).toHaveCount(0);
        const rows = await verifyOriginals(fresh, true);
        receipt.finalSources = rows.map(row => ({ id: row.id, title: row.title, contentSha256: hash(row.content) }));
      } finally { await fresh.close(); }
    });
    receipt.outcome = 'passed';
  } finally {
    await persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
