import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Actual on-disk bytes selected through visible UI; no fake File.size, injected
// application storage, auth API bypass, intercepted responses or provider mocks.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off' });
type Source = { id: string; title: string; content: string; processingStatus?: string; processing_status?: string; metadata?: unknown };
type FailureMetadata = { processingError: { code: string } };
type ValidationReceipt = Record<string, unknown> & { stages: { name: string; status: 'passed' | 'failed' }[]; fixtures: { name: string; bytes: number; sha256: string }[] };
const title = (name: string) => name.replace(/\.[^.]+$/, '');
function card(page: Page, name: string) {
  return page.locator('span.text-sm.font-medium').and(page.getByText(title(name), { exact: true })).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
}
async function sourcesTab(page: Page) {
  const tab = page.getByRole('tab', { name: /(?:^|\s)Sources$/ });
  await expect(tab.or(page.getByRole('heading', { name: 'Sources', exact: true })).first()).toBeVisible();
  if (await tab.count()) await tab.click();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}
async function addDialog(page: Page) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function openFact(page: Page, name: string, fact: string) {
  await sourcesTab(page);
  await expect(card(page, name).getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.locator('span.text-sm.font-medium').and(page.getByText(title(name), { exact: true })).click();
  const viewer = page.getByTestId('source-content-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.prose').filter({ hasText: fact })).toBeVisible();
  await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}

test('upload-validation: native mixed batch rejects real empty and oversized files while retaining valid sources and durable extraction failure', async ({ page, context }, testInfo) => {
  test.setTimeout(300_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  const root = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  const directory = join(root, `upload-validation-fixtures-${testInfo.project.name}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const names = { txt: 'Cedar valid mixed.txt', pdf: 'Cedar valid mixed PDF.pdf', corrupt: 'Cedar corrupt mixed.docx', empty: 'Cedar empty mixed.txt', large: 'Cedar oversized mixed.txt', next: 'Cedar next selection.txt' };
  const facts = { txt: 'The mixed text station stores exactly 17 blue trays.', pdf: 'The mixed PDF station stores exactly 23 amber jars.', next: 'The next selection station stores exactly 43 green boxes.' };
  const prose = (fact: string) => `${fact}\nThis synthetic classroom inventory has no personal information. Learners record the station inventory before each inspection. The precise inventory statement must survive extraction and reopening. All objects and stations in this exercise are fictional.`;
  await writeFile(join(directory, names.txt), prose(facts.txt));
  await writeFile(join(directory, names.next), prose(facts.next));
  await writeFile(join(directory, names.corrupt), 'Deliberately corrupt synthetic DOCX: not a ZIP archive.');
  await writeFile(join(directory, names.empty), Buffer.alloc(0));
  // Real allocated bytes, not a mocked File.size or sparse-file size override.
  await writeFile(join(directory, names.large), Buffer.alloc(50 * 1024 * 1024 + 1, 65));
  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdfPage.drawText(prose(facts.pdf).match(/.{1,75}(?:\s|$)/g)!.join('\n'), { x: 30, y: 780, font, size: 12, lineHeight: 18 });
  await writeFile(join(directory, names.pdf), await pdf.save());
  const receipt: ValidationReceipt = { scenario: 'upload-validation', project: testInfo.project.name, outcome: 'failed', stages: [], fixtures: [],
    boundary: 'Synthetic disposable owner; actual on-disk files via visible native picker; real extraction and read-only server checks. No unsupported-file drop, OS picker cancellation, 20-file/250MB limit, provider outage or release readiness claim.' };
  receipt.fixtures = await Promise.all(Object.values(names).map(async name => ({ name, bytes: (await stat(join(directory, name))).size, sha256: createHash('sha256').update(await readFile(join(directory, name))).digest('hex') })));
  expect(receipt.fixtures.find(entry => entry.name === names.large).bytes).toBe(50 * 1024 * 1024 + 1);
  const persist = () => writeFile(join(root, `upload-validation-${testInfo.project.name}.json`), JSON.stringify(receipt, null, 2));
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name; await persist();
    try { await test.step(name, action); receipt.stages.push({ name, status: 'passed' }); }
    catch (error) { receipt.stages.push({ name, status: 'failed' }); throw error; }
    finally { await persist(); }
  }
  let notebookId = ''; let durableError = ''; let corruptId = '';
  async function savedSources(): Promise<Source[]> {
    const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
    expect(response.status()).toBe(200);
    const body = await response.json(); const rows = body.sources || body;
    expect(Array.isArray(rows)).toBe(true); return rows;
  }
  async function verifyRows(count: number) {
    const rows = await savedSources(); expect(rows).toHaveLength(count);
    for (const name of [names.empty, names.large]) expect(rows.some(row => row.title === name || row.title === title(name))).toBe(false);
    for (const key of ['txt', 'pdf'] as const) expect(rows.find(row => row.title === names[key] || row.title === title(names[key]))?.content).toContain(facts[key]);
    return rows;
  }
  try {
    await stage('ui-signup-and-disposable-owner-notebook', async () => {
      const identity = randomUUID(); const email = `validation-${identity}@studypod.invalid`;
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`Upload validation ${identity}`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/auth/signup'));
      await page.getByRole('button', { name: 'Create Account', exact: true }).click(); expect((await response).status()).toBe(201);
      await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
      const profile = await context.request.get('/api/user/profile'); expect(profile.status()).toBe(200); expect((await profile.json()).user.email).toBe(email);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/); notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
    });
    await stage('native-mixed-selection-visible-filename-rejections', async () => {
      const dialog = await addDialog(page); const chooser = page.waitForEvent('filechooser');
      await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
      const picker = await chooser; expect(picker.isMultiple()).toBe(true);
      await picker.setFiles([names.txt, names.pdf, names.corrupt, names.empty, names.large].map(name => join(directory, name)));
      await expect(page.getByText('Some files were skipped', { exact: true })).toBeVisible();
      await expect(page.getByText(`${names.empty}: The file is empty; ${names.large}: Larger than the 50 MB limit`, { exact: true })).toBeVisible();
      await expect(dialog).toBeHidden();
    });
    await stage('valid-facts-independent-of-durable-corrupt-docx-failure', async () => {
      await openFact(page, names.txt, facts.txt); await openFact(page, names.pdf, facts.pdf);
      const failed = card(page, names.corrupt);
      await expect(failed.getByText('Failed', { exact: true })).toBeVisible({ timeout: 90_000 });
      await expect(failed.locator('p')).toContainText(/extracting:/i); await expect(failed.locator('p')).toContainText(/DOCX|zip|central directory/i);
      durableError = await failed.locator('p').innerText();
      const rows = await verifyRows(3); const saved = rows.find(row => row.title === names.corrupt || row.title === title(names.corrupt))!;
      expect(saved).toBeTruthy(); corruptId = saved.id;
      expect(saved.processingStatus || saved.processing_status).toBe('failed');
      const metadata: FailureMetadata = typeof saved.metadata === 'string' ? JSON.parse(saved.metadata) : saved.metadata as FailureMetadata;
      expect(metadata).toMatchObject({ fileName: names.corrupt, processingStage: 'extracting', processingError: { code: 'SOURCE_EXTRACTION_FAILED', stage: 'extracting', retryable: true } });
      receipt.failure = { id: corruptId, visibleDetail: durableError, code: metadata.processingError.code };
      await page.reload(); await sourcesTab(page);
      await expect(card(page, names.corrupt).locator('p')).toHaveText(durableError);
      await expect(card(page, names.corrupt).getByText('Failed', { exact: true })).toBeVisible();
      await verifyRows(3); await openFact(page, names.txt, facts.txt); await openFact(page, names.pdf, facts.pdf);
    });
    await stage('keyboard-picker-activation-and-subsequent-valid-selection', async () => {
      const dialog = await addDialog(page);
      const zone = dialog.getByRole('button', { name: 'Upload source files', exact: true });
      await page.evaluate(() => {
        const events: unknown[] = [];
        (window as Window & { __uploadKeyboardEvents?: unknown[] }).__uploadKeyboardEvents = events;
        for (const type of ['focusin', 'keydown', 'click']) document.addEventListener(type, event => {
          const target = event.target as HTMLElement;
          if (target.closest('[role="dialog"]')) events.push({ type, tag: target.tagName, label: target.getAttribute('aria-label'), inputType: target.getAttribute('type'), key: (event as KeyboardEvent).key, trusted: event.isTrusted, activation: navigator.userActivation.isActive, documentFocused: document.hasFocus(), connected: target.isConnected, disabled: (target as HTMLInputElement).disabled });
        }, true);
      });
      await page.bringToFront();
      await zone.focus(); await expect(zone).toBeFocused();
      const chooser = page.waitForEvent('filechooser'); await page.keyboard.press('Enter');
      try { await (await chooser).setFiles(join(directory, names.next)); }
      finally { receipt.keyboardEvents = await page.evaluate(() => (window as Window & { __uploadKeyboardEvents?: unknown[] }).__uploadKeyboardEvents); await persist(); }
      await expect(dialog).toBeHidden();
      await openFact(page, names.next, facts.next); await page.reload();
      for (const key of ['txt', 'pdf', 'next'] as const) await openFact(page, names[key], facts[key]);
      const rows = await verifyRows(4);
      expect(rows.find(row => row.id === corruptId)?.processingStatus || rows.find(row => row.id === corruptId)?.processing_status).toBe('failed');
      expect(rows.find(row => row.title === names.next || row.title === title(names.next))?.content).toContain(facts.next);
      await expect(card(page, names.corrupt).locator('p')).toHaveText(durableError);
      receipt.finalSources = rows.map(row => ({ id: row.id, title: row.title, contentSha256: createHash('sha256').update(row.content || '').digest('hex') }));
    });
    receipt.outcome = 'passed';
  } finally {
    await persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
