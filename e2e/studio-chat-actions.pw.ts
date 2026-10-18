import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatDisplayTitle } from '../src/lib/utils/displayTitle.js';
import { content } from './full-flow-fixtures.mjs';
import { cedarCitationCoverage } from './helpers/cedarStatementOracle';

interface Source { id: string; title: string; content: string; processingStatus: string }
interface Message { id: string; role: string; content: string; groundedSources?: unknown; grounded_sources?: unknown }
interface Note { id: string; title: string; content: string; storedContent: string }
interface Receipt {
  [key: string]: unknown;
  phase: string;
  stages: Record<string, { status: string; startedAt: string; finishedAt?: string; errorClass?: string }>;
}
const trayFact = /\b(?:17|seventeen)\s+(?:blue\s+)?trays\b/i;
const lightFact = /\b(?:six|6)\s+hours?\b.{0,100}\blight\b|\blight\b.{0,100}\b(?:six|6)\s+hours?\b/i;
const prose = (text: string) => text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ');
const groundedFacts = (text: string) => trayFact.test(prose(text)) && lightFact.test(prose(text));
const assertFacts = (text: string) => {
  expect(prose(text), 'The answer must retain the Cedar tray count').toMatch(trayFact);
  expect(prose(text), 'The answer must retain daily light duration').toMatch(lightFact);
};
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function tab(page: Page, name: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport!.width >= 1100) return;
  const control = page.getByRole('tab', { name: new RegExp('(?:^|\\s)' + name + '$') });
  await expect(control).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}
async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Chat capture ${randomUUID()}`);
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
async function list<T>(context: BrowserContext, path: string): Promise<T[]> {
  const response = await context.request.get(path);
  expect(response.status()).toBe(200);
  const rows: unknown = await response.json();
  expect(Array.isArray(rows), 'Notebook collection endpoint returns a raw array').toBe(true);
  return rows as T[];
}
async function notes(context: BrowserContext, path: string): Promise<Note[]> {
  return (await list<Record<string, unknown>>(context, path)).map(raw => {
    expect(typeof raw.id).toBe('string');
    expect(typeof raw.content).toBe('string');
    const storedContent = raw.content as string;
    const explicitTitle = typeof raw.title === 'string' ? raw.title : '';
    const heading = !explicitTitle ? /^# ([^\r\n]+)\r?\n(?:\r?\n)?/.exec(storedContent) : null;
    return { id: raw.id as string, title: explicitTitle || heading?.[1].trim() || 'Untitled Note',
      content: heading ? storedContent.slice(heading[0].length) : storedContent, storedContent };
  });
}

test('studio-chat-actions-grounded-capture: citation evidence, saved answer, reload, fresh login and ownership', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(420_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  const ownerEmail = `chat-${randomUUID()}@studypod.invalid`;
  const foreignEmail = `chat-foreign-${randomUUID()}@studypod.invalid`;
  const sourceTitle = `Cedar chat capture ${randomUUID().slice(0, 8)}`;
  const root = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  mkdirSync(root, { recursive: true });
  const receipt: Receipt = { phase: 'initializing', stages: {}, project: testInfo.project.name,
    target: testInfo.project.use.baseURL, mockedAuthProviderOrData: false,
    knownFacts: ['17 blue trays', 'six hours of light daily'], citationInteraction: 'inline evidence expansion' };
  const persist = () => writeFileSync(resolve(root, `${testInfo.project.name}-studio-chat-actions.json`), JSON.stringify(receipt, null, 2));
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name;
    receipt.stages[name] = { status: 'started', startedAt: new Date().toISOString() };
    persist();
    try {
      await test.step(name, action);
      Object.assign(receipt.stages[name], { status: 'passed', finishedAt: new Date().toISOString() });
    } catch (error) {
      Object.assign(receipt.stages[name], { status: 'failed', finishedAt: new Date().toISOString(), errorClass: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    } finally { persist(); }
  }
  let notebookId = '';
  let sourceId = '';
  let answer!: Message;
  let captured!: Note;
  const extraContexts: BrowserContext[] = [];
  const path = (suffix: string) => `/api/notebooks/${notebookId}${suffix}`;
  const answerCard = (active: Page) => active.locator('div.group.flex')
    .filter({ has: active.getByRole('button', { name: 'Save response as note', exact: true }) })
    .filter({ has: active.getByRole('button', { name: 'Citation 1', exact: true }) });
  async function assertStored(activeContext: BrowserContext) {
    const sources = await list<Source>(activeContext, path('/sources'));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: sourceId, title: sourceTitle, content });
    const rows = await list<Message>(activeContext, path('/messages'));
    expect(rows.filter(row => row.role === 'assistant')).toHaveLength(1);
    const saved = rows.find(row => row.id === answer.id);
    expect(saved?.content).toBe(answer.content);
    let envelope: unknown = saved?.groundedSources ?? saved?.grounded_sources;
    if (typeof envelope === 'string') envelope = JSON.parse(envelope);
    expect(envelope).toMatchObject({ version: 1, sourceIds: expect.arrayContaining([sourceId]),
      citations: expect.arrayContaining([expect.objectContaining({ citation_id: 1, source_id: sourceId, source_title: sourceTitle })]) });
    const savedNotes = await notes(activeContext, path('/notes'));
    expect(savedNotes).toHaveLength(1);
    expect(savedNotes[0]).toEqual(captured);
  }
  async function citation(active: Page) {
    await tab(active, 'Chat');
    const card = answerCard(active);
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    assertFacts(await card.innerText());
    const controls = card.getByRole('button', { name: /^Citation \d+$/ });
    await expect(controls.first()).toBeVisible();
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    const evidenceIds = new Set<string>();
    const coverage = { trays: false, light: false };
    // A grounded answer may cite [1] repeatedly. Verify every occurrence and
    // its own linked panel rather than assuming the citation label is unique.
    for (let index = 0; index < count; index++) {
      const control = controls.nth(index);
      const evidenceId = await control.getAttribute('aria-controls');
      expect(evidenceId).toBeTruthy();
      expect(evidenceIds.has(evidenceId!)).toBe(false);
      evidenceIds.add(evidenceId!);
      await expect(control).toHaveAttribute('aria-expanded', 'false');
      await control.click();
      await expect(control).toHaveAttribute('aria-expanded', 'true');
      const evidence = active.locator(`[id="${evidenceId}"]`);
      await expect(evidence).toHaveCount(1);
      await expect(evidence.getByText(sourceTitle, { exact: true })).toBeVisible();
      const excerpt = (await evidence.locator('span.whitespace-pre-wrap').allTextContents()).join('\n');
      const supported = cedarCitationCoverage(excerpt, content);
      expect(supported, 'Each citation must quote the uploaded source and support a requested fact').not.toBeNull();
      coverage.trays ||= supported!.trays;
      coverage.light ||= supported!.light;
      await control.press('Enter');
      await expect(control).toHaveAttribute('aria-expanded', 'false');
      await expect(evidence).toBeHidden();
      await control.press('Enter');
      await expect(control).toHaveAttribute('aria-expanded', 'true');
      await expect(evidence).toBeVisible();
      expect((await evidence.locator('span.whitespace-pre-wrap').allTextContents()).join('\n')).toBe(excerpt);
      await control.press('Enter');
      await expect(control).toHaveAttribute('aria-expanded', 'false');
      await expect(evidence).toBeHidden();
    }
    expect(coverage, 'Citation excerpts collectively support both answer facts').toEqual({ trays: true, light: true });
    receipt.verifiedCitationOccurrences = count;
    receipt.verifiedCitationCoverage = coverage;
  }
  async function openCaptured(active: Page) {
    await tab(active, 'Studio');
    const region = active.getByRole('region', { name: 'Notes', exact: true });
    const note = region.getByRole('button').filter({ has: active.getByRole('heading', { name: captured.title, exact: true }) });
    await expect(note).toHaveCount(1);
    await expect(note).toBeVisible();
    await note.click();
    await expect(active.getByPlaceholder('Write your note here...')).toHaveValue(answer.content);
  }
  async function freshContext() {
    const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block',
      viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
    extraContexts.push(fresh);
    return fresh;
  }
  try {
    await stage('isolated-signup-and-owned-notebook', async () => {
      await authenticate(page, ownerEmail, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
    });
    await stage('real-source-intake', async () => {
      await tab(page, 'Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      await page.getByRole('button', { name: /Pasted Content/ }).click();
      await page.getByLabel('Title', { exact: true }).fill(sourceTitle);
      await page.getByLabel('Content', { exact: true }).fill(content);
      await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      await expect.poll(async () => {
        const sources = await list<Source>(context, path('/sources'));
        const source = sources.find(row => row.title === sourceTitle);
        if (source && source.content === content && ['completed', 'degraded'].includes(source.processingStatus)) { sourceId = source.id; return true; }
        return false;
      }, { timeout: 65_000 }).toBe(true);
      await expect(page.locator('span.text-sm.font-medium').and(page.getByText(sourceTitle, { exact: true }))).toBeVisible();
      receipt.sourceId = sourceId;
    });
    await stage('real-provider-grounded-chat', async () => {
      // Existing local acceptance uses one provider slot; allow intake's bounded
      // background enrichment to finish before submitting the real chat request.
      await page.reload();
      await page.waitForTimeout(46_000);
      await tab(page, 'Chat');
      const input = page.getByPlaceholder(/Start typing|Ask only/);
      await input.fill('In the Cedar experiment, exactly how many blue trays are used and how many hours of light do the seedlings receive daily? Give both source facts and cite the source.');
      await input.press('Enter');
      await expect.poll(async () => {
        const rows = await list<Message>(context, path('/messages'));
        const match = rows.find(row => row.role === 'assistant' && groundedFacts(row.content));
        if (match) { answer = match; return true; }
        return false;
      }, { timeout: 65_000 }).toBe(true);
      assertFacts(answer.content);
      receipt.messageId = answer.id;
    });
    await stage('citation-linked-evidence-and-keyboard', async () => { await citation(page); });
    await stage('save-answer-and-immediate-studio-discovery', async () => {
      expect(await notes(context, path('/notes'))).toHaveLength(0);
      const card = answerCard(page);
      const save = card.getByRole('button', { name: 'Save response as note', exact: true });
      await save.focus(); // Makes group-focus-within capture controls visible on touch screens too.
      await expect(save).toBeVisible();
      const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === path('/notes'));
      await save.click();
      expect((await response).status()).toBe(201);
      await expect.poll(async () => (await notes(context, path('/notes'))).length).toBe(1);
      [captured] = await notes(context, path('/notes'));
      expect(captured.title).toBe(formatDisplayTitle(answer.content.split('\n')[0] || 'Captured insight', 'Captured insight'));
      expect(captured.content).toBe(answer.content);
      assertFacts(captured.content);
      receipt.noteId = captured.id;
      await openCaptured(page); // No reload/navigation may mask immediate Notes query invalidation.
      await assertStored(context);
    });
    await stage('reload-chat-citation-and-captured-note', async () => {
      await page.reload();
      await citation(page);
      await openCaptured(page);
      await assertStored(context);
    });
    await stage('fresh-owner-login-and-reopen', async () => {
      const owner = await freshContext();
      const active = await owner.newPage();
      await authenticate(active, ownerEmail, false);
      await active.goto(`/notebook/${notebookId}`);
      await tab(active, 'Sources');
      await expect(active.locator('span.text-sm.font-medium').and(active.getByText(sourceTitle, { exact: true }))).toBeVisible();
      await citation(active);
      await openCaptured(active);
      await assertStored(owner);
    });
    await stage('second-account-denial-and-owner-data-intact', async () => {
      const foreign = await freshContext();
      const active = await foreign.newPage();
      await authenticate(active, foreignEmail, true);
      for (const suffix of ['', '/sources', '/messages', '/notes', `/notes/${captured.id}`]) {
        const response = await foreign.request.get(path(suffix));
        expect([403, 404]).toContain(response.status());
        const body = await response.text();
        expect(body).not.toContain(sourceTitle);
        expect(body).not.toMatch(trayFact);
      }
      await active.goto(`/notebook/${notebookId}`);
      await expect(active.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
      await expect(active.locator('body')).not.toContainText(sourceTitle);
      await expect(active.locator('body')).not.toContainText(captured.title);
      expect(await active.locator('body').innerText()).not.toMatch(trayFact);
      await assertStored(context);
      receipt.ownershipDenialEndpoints = 5;
    });
    receipt.phase = 'complete';
  } finally {
    persist();
    await testInfo.attach('sanitized-studio-acceptance-receipt', {
      body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json',
    });
    for (const extra of extraContexts) await extra.close();
  }
});
