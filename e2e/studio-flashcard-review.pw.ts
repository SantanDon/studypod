import { ratioDiagnosticPrefix, ratioDiagnosticsEnabled, parseRatioDiagnostic, type SafeRatioDiagnostic } from './flashcard-ratio-diagnostics';
import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Request, type ConsoleMessage } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FlashcardDeck } from '../src/types/flashcard.js';
import { formatDisplayTitle } from '../src/lib/utils/displayTitle.js';
import { content } from './full-flow-fixtures.mjs';
import { auditProseCard } from './source-prose-oracle.mjs';

const acceptanceDiagnosticReasons = ["schema_validation","no_schema_valid_records","evidence_occurrence","evidence_length","source_instruction","empty_answer","answer_length","answer_word_count","trivial_answer","blank_marker","answer_absent","answer_occurrence","word_boundary","context_word_count","answer_context_ratio","duplicate_evidence"] as const;
const acceptanceDiagnosticPrefix = '[StudyPod flashcard acceptance] ';
interface SafeAcceptanceDiagnostic {
  version: 1; responseCharacters: number; responseBytes: number; responseSha256: string | null;
  requestedCount: number; selectedCards: number; parsedRecords: number; eligibleCards: number;
  rejections: Record<typeof acceptanceDiagnosticReasons[number], number>;
}
function parseAcceptanceDiagnostic(type: string, text: string): SafeAcceptanceDiagnostic | null {
  if (type !== 'info' || !text.startsWith(acceptanceDiagnosticPrefix) || text.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(text.slice(acceptanceDiagnosticPrefix.length));
    const exactKeys = (obj: unknown, keys: readonly string[]): obj is Record<string, unknown> => !!obj && typeof obj === 'object' && !Array.isArray(obj)
      && Object.keys(obj).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(obj, key));
    if (!exactKeys(value, ['version', 'responseCharacters', 'responseBytes', 'responseSha256', 'requestedCount', 'selectedCards', 'parsedRecords', 'eligibleCards', 'rejections'])) return null;
    const integer = (number: unknown, max: number): number is number => Number.isSafeInteger(number) && Number(number) >= 0 && Number(number) <= max;
    if (value.version !== 1 || !integer(value.responseCharacters, 100_000_000) || !integer(value.responseBytes, 400_000_000)
      || Number(value.responseBytes) < Number(value.responseCharacters) || Number(value.responseBytes) > Number(value.responseCharacters) * 4
      || !(value.responseSha256 === null || typeof value.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.responseSha256))
      || !integer(value.requestedCount, 50) || value.requestedCount === 0 || !integer(value.selectedCards, 50)
      || !integer(value.parsedRecords, 10000) || !integer(value.eligibleCards, 10000)
      || Number(value.selectedCards) > Number(value.requestedCount) || Number(value.selectedCards) > Number(value.eligibleCards)
      || Number(value.eligibleCards) > Number(value.parsedRecords)) return null;
    const rejections = value.rejections;
    if (!exactKeys(rejections, acceptanceDiagnosticReasons)
      || !acceptanceDiagnosticReasons.every(reason => integer(rejections[reason], 10000))) return null;
    return value as unknown as SafeAcceptanceDiagnostic;
  } catch { return null; }
}


type Source = { id: string; title: string; content: string; processingStatus: string };
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function tab(page: Page, name: 'Sources' | 'Studio') {
  if ((page.viewportSize()?.width ?? 1280) >= 1100) return;
  const control = page.getByRole('tab', { name: new RegExp('(?:^|\\s)' + name + '$') });
  await expect(control).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
}

async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Cedar mixed ${randomUUID()}`);
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
  if (signup) await page.locator('#tosAccepted').click();
  const acknowledged = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith(`/api/auth/${signup ? 'signup' : 'signin'}`));
  await page.getByRole('button', { name: signup ? 'Create Account' : 'Sign in', exact: true }).click();
  expect((await acknowledged).status()).toBe(signup ? 201 : 200);
  await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
  const profile = await page.context().request.get('/api/user/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(email);
}

// Match intent plus the decoded, complete supplied fixture rather than obsolete coach prose.
function generationRequest(request: Request, url: string) {
  if (request.method() !== 'POST' || request.url() !== url) return false;
  const systemIntent = (value: unknown) => typeof value === 'string'
    && value.startsWith('Create source-completion flashcards by selecting important knowledge from SOURCE_TEXT.');
  const fixtureSelection = (value: unknown) => {
    if (typeof value !== 'string' || !/^Select (?:up to )?\d+ distinct educational source-completion cards\b/.test(value)) return false;
    const source = value.match(/SOURCE_TEXT:\s*("(?:\\.|[^"\\])*")\s*$/);
    if (!source) return false;
    try { return JSON.parse(source[1]) === content; } catch { return false; }
  };
  try {
    const body = request.postDataJSON();
    if (!body || typeof body !== 'object') return false;
    if (typeof body.prompt === 'string') {
      // Current direct transport flattens the two messages and appends Assistant:.
      const prompt = body.prompt.replace(/\n\nAssistant:\s*$/, '');
      const split = prompt.indexOf('\n\nUser: ');
      return split > 0 && systemIntent(prompt.slice(0, split).replace(/^System: /, ''))
        && fixtureSelection(prompt.slice(split + '\n\nUser: '.length));
    }
    return Array.isArray(body.messages) && body.messages.length === 2
      && body.messages[0]?.role === 'system' && systemIntent(body.messages[0]?.content)
      && body.messages[1]?.role === 'user' && fixtureSelection(body.messages[1]?.content);
  } catch { return false; }
}

test('studio-flashcard-mixed-review: grounded Qwen cards, Again Hard Good, due resumption and private ownership', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(360_000);
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(process.env.STUDYPOD_FULL_FIXTURES).toBeTruthy();
  const email = `mixed-${randomUUID()}@example.test`;
  const foreignEmail = `mixed-foreign-${randomUUID()}@example.test`;
  const deckName = `Cedar mixed ${randomUUID()}`;
  const receipt: Record<string, unknown> = { target: testInfo.project.use.baseURL, mockedAuthOrData: false, stages: {}, pageErrors: [] };
  const stages: Record<string, { status: string; startedAt: string; finishedAt?: string; error?: string }> = {};
  receipt.stages = stages;
  const sanitize = (value: unknown) => String(value).split(process.env.STUDYPOD_AUTH_PASSWORD!).join('[password]').split(email).join('[account]').split(foreignEmail).join('[account]').slice(0, 2000);
  const root = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  mkdirSync(root, { recursive: true });
  const persist = () => writeFileSync(resolve(root, `${testInfo.project.name}-studio-flashcard-review.json`), JSON.stringify(receipt, null, 2));
  const diagnosticObservations: SafeAcceptanceDiagnostic[] = [];
  let invalidDiagnosticCount = 0, droppedDiagnosticCount = 0;
  let collectingGenerationDiagnostics = false;
  const diagnosticsEnabled = process.env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1';
  const ratioObservations: SafeRatioDiagnostic[] = [];
  let invalidRatioCount = 0, droppedRatioCount = 0;
  const observeDiagnostic = (message: ConsoleMessage) => {
    if (!collectingGenerationDiagnostics || message.type() !== 'info') return;
    if (ratioDiagnosticsEnabled() && message.text().startsWith(ratioDiagnosticPrefix)) {
      const value = parseRatioDiagnostic(message.type(), message.text());
      if (!value) invalidRatioCount = Math.min(10000, invalidRatioCount + 1);
      else if (ratioObservations.length >= 50) droppedRatioCount = Math.min(10000, droppedRatioCount + 1);
      else ratioObservations.push(value);
      receipt.ratioDiagnostics = { evidenceClass: 'acceptance-diagnostics', observations: ratioObservations, invalidCount: invalidRatioCount, droppedCount: droppedRatioCount };
      persist();
      return;
    }
    if (!collectingGenerationDiagnostics || message.type() !== 'info' || !message.text().startsWith(acceptanceDiagnosticPrefix)) return;
    const value = parseAcceptanceDiagnostic(message.type(), message.text());
    if (!value) invalidDiagnosticCount = Math.min(10000, invalidDiagnosticCount + 1);
    else if (diagnosticObservations.length >= 50) droppedDiagnosticCount = Math.min(10000, droppedDiagnosticCount + 1);
    else diagnosticObservations.push(value);
    receipt.acceptanceDiagnostics = { evidenceClass: 'acceptance-diagnostics', observations: diagnosticObservations,
      invalidCount: invalidDiagnosticCount, droppedCount: droppedDiagnosticCount, missing: diagnosticObservations.length === 0 };
    persist();
  };
  if (diagnosticsEnabled) page.on('console', observeDiagnostic);
  const observe = (active: Page) => active.on('pageerror', error => { (receipt.pageErrors as string[]).push(sanitize(error.message)); persist(); });
  observe(page);
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name;
    stages[name] = { status: 'started', startedAt: new Date().toISOString() };
    persist();
    try { await test.step(name, action); stages[name].status = 'passed'; }
    catch (error) { stages[name].status = 'failed'; stages[name].error = sanitize(error instanceof Error ? error.message : error); throw error; }
    finally { stages[name].finishedAt = new Date().toISOString(); persist(); }
  }
  let notebookId = '';
  let source!: Source;
  let deck!: FlashcardDeck;
  const contexts: BrowserContext[] = [];
  const decksPath = () => `/api/notebooks/${notebookId}/studio/decks`;
  const deckPath = () => `${decksPath()}/${deck.id}`;
  async function readDeck(active: BrowserContext): Promise<FlashcardDeck> {
    const response = await active.request.get(deckPath());
    expect(response.status()).toBe(200);
    return (await response.json()).deck;
  }
  async function openDeck(active: Page) {
    await tab(active, 'Studio');
    const trigger = active.getByRole('button', { name: /^Flashcards/ }).first();
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await expect(active.getByRole('heading', { name: deckName, exact: true })).toBeVisible();
  }
  const deckCard = (active: Page) => active.getByRole('heading', { name: deckName, exact: true }).locator('..').locator('..').locator('..');
  async function stats(active: Page, due: number, learning: number, accuracy: number) {
    const card = deckCard(active);
    for (const text of [`${due} due`, `${learning} learning`, '0 mastered', `${accuracy}% accuracy`]) await expect(card.getByText(text, { exact: true })).toBeVisible();
  }
  async function finish(active: Page, count: number) {
    await expect(active.getByRole('heading', { name: 'Session Complete!', exact: true })).toBeVisible();
    await expect(active.getByText(`You reviewed ${count} cards.`, { exact: true })).toBeVisible();
    await active.getByRole('button', { name: /(?:^|\s)Done$/ }).click();
  }
  async function rate(active: Page, index: number, total: number, cardId: string, label: string, quality: number, key: string) {
    await stage(key, async () => {
      const before = structuredClone(deck);
      const original = before.cards.find(card => card.id === cardId)!;
      await expect(active.getByText(`Card ${index + 1} of ${total}`, { exact: true })).toBeVisible();
      const reveal = active.getByRole('button', { name: 'Reveal answer', exact: true });
      await expect(reveal.getByText(original.front, { exact: true })).toBeVisible();
      await reveal.click();
      const rotation = active.locator('[style*="preserve-3d"]');
      await expect(rotation).toHaveCount(1);
      // Backface DOM text alone is not a visible answer: require the actual flip.
      await expect.poll(() => rotation.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m11 < -0.98)).toBe(true);
      await expect(rotation.getByText(original.back, { exact: true })).toBeVisible();
      const acknowledged = active.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === deckPath());
      const started = Date.now();
      await active.getByRole('button', { name: new RegExp('(?:^|\\s)' + label + '$') }).click();
      const response = await acknowledged;
      const after = (await response.json()).deck as FlashcardDeck;
      receipt[key] = { status: response.status(), before, after, cardId, quality };
      persist();
      expect(response.status()).toBe(200);
      expect(after.version).toBe(before.version! + 1);
      expect(after.cards.map(card => card.id)).toEqual(before.cards.map(card => card.id));
      const rated = after.cards.find(card => card.id === cardId)!;
      expect({ front: rated.front, back: rated.back, sourceId: rated.sourceId }).toEqual({ front: original.front, back: original.back, sourceId: source.id });
      expect(rated.correctCount).toBe(original.correctCount + (quality >= 3 ? 1 : 0));
      expect(rated.incorrectCount).toBe(original.incorrectCount + (quality < 3 ? 1 : 0));
      expect(rated.interval).toBe(quality < 3 ? 0 : 1);
      expect(rated.difficulty).toBe(quality >= 2 ? 'medium' : 'hard');
      expect(rated.easeFactor).toBeCloseTo(Math.max(1.3, original.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)), 8);
      expect(Date.parse(rated.lastReviewed!)).toBeGreaterThanOrEqual(started - 2000);
      expect(Date.parse(rated.lastReviewed!)).toBeLessThanOrEqual(Date.now() + 2000);
      const next = Date.parse(rated.nextReview!);
      expect(next).toBeGreaterThanOrEqual(started - 2000);
      expect(next).toBeLessThanOrEqual(Date.now() + (quality < 3 ? 2000 : 26 * 3600_000));
      if (quality >= 3) expect(next).toBeGreaterThan(started + 22 * 3600_000);
      expect(after.cards.filter(card => card.id !== cardId)).toEqual(before.cards.filter(card => card.id !== cardId));
      deck = after;
      expect(await readDeck(active.context())).toEqual(deck);
    });
  }
  try {
    await stage('real-owner-native-source', async () => {
      await authenticate(page, email, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
      await tab(page, 'Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Browse files', exact: true }).click();
      await (await chooser).setFiles(resolve(process.env.STUDYPOD_FULL_FIXTURES!, 'cedar.txt'));
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
        expect(response.status()).toBe(200);
        const data = await response.json();
        const sources = (data.sources || data) as Source[];
        source = sources[0];
        return sources.length === 1 && ['completed', 'degraded'].includes(source?.processingStatus) && source.content.includes(content);
      }, { timeout: 120_000 }).toBe(true);
      receipt.source = source;
      await page.locator('span.text-sm.font-medium').and(page.getByText(formatDisplayTitle(source.title, 'Untitled source'), { exact: true })).click();
      await expect(page.locator('.prose').filter({ hasText: /17 blue trays/ })).toBeVisible();
      await page.reload();
      // Existing source processing schedules inference within 45 seconds; runner owns the exclusive provider slot.
      await page.waitForTimeout(46_000);
    });
    await stage('real-qwen-cards-and-independent-prose-audit', async () => {
      await tab(page, 'Studio');
      await page.getByRole('button', { name: /^Flashcards/ }).first().click();
      await page.getByRole('button', { name: /(?:^|\s)New Deck$/ }).click();
      await page.getByPlaceholder('Deck name...').fill(deckName);
      await page.getByRole('button', { name: /(?:^|\s)Create Deck$/ }).click();
      await expect(page.getByRole('heading', { name: deckName, exact: true })).toBeVisible();
      await page.getByRole('button', { name: /(?:^|\s)Generate$/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Generate Flashcards', exact: true })).toBeVisible();
      for (const [index, name] of [deckName, source.title, '3 cards'].entries()) {
        await dialog.getByRole('combobox').nth(index).click();
        await page.getByRole('option', { name, exact: true }).click();
      }
      const direct = ['1', 'true'].includes(process.env.VITE_ENABLE_OLLAMA || '');
      const base = (direct ? process.env.VITE_OLLAMA_BASE_URL || process.env.VITE_OLLAMA_BASE || 'http://localhost:11434' : process.env.VITE_API_URL || '/api').replace(/\/$/, '');
      const url = new URL(`${base}/${direct ? 'api/generate' : 'ai/generate'}`, testInfo.project.use.baseURL).href;
      collectingGenerationDiagnostics = true;
      if (diagnosticsEnabled) receipt.acceptanceDiagnostics = { evidenceClass: 'acceptance-diagnostics', observations: diagnosticObservations, invalidCount: 0, droppedCount: 0, missing: true };
      const generated = page.waitForResponse(response => generationRequest(response.request(), url), { timeout: 120_000 });
      await dialog.getByRole('button', { name: /(?:^|\s)Generate Cards$/ }).click();
      const response = await generated;
      const body = await response.json();
      receipt.provider = { mode: direct ? 'direct' : 'server', path: new URL(url).pathname, status: response.status(), modelUsed: direct ? body.model : body.modelUsed };
      persist();
      expect(response.status()).toBe(200);
      expect(direct ? body.model : body.modelUsed).toBe('qwen3.5:9b');
      if (direct) expect(response.request().postDataJSON().model).toBe('qwen3.5:9b');
      expect(String(direct ? body.response : body.answer).trim().length).toBeGreaterThan(0);
      await expect.poll(async () => {
        const result = await context.request.get(decksPath());
        expect(result.status()).toBe(200);
        deck = (await result.json()).decks.find((entry: FlashcardDeck) => entry.name === deckName);
        return deck?.cards.length;
      }, { timeout: 60_000 }).toBe(3);
      const audits = deck.cards.map(card => auditProseCard({ card, source, profile: 'cedar', authorizedSourceIds: [source.id] }));
      receipt.generatedDeck = structuredClone(deck);
      receipt.proseAudits = audits;
      persist();
      expect(audits.map(audit => audit.outcome)).toEqual(['independently-supported', 'independently-supported', 'independently-supported']);
      for (const card of deck.cards) {
        expect(card.sourceId).toBe(source.id);
        expect([card.correctCount, card.incorrectCount, card.interval]).toEqual([0, 0, 0]);
      }
    });
    const ids = deck.cards.map(card => card.id);
    await deckCard(page).getByRole('button', { name: /Review 3 Cards$/ }).click();
    await rate(page, 0, 3, ids[0], 'Again', 0, 'first-again');
    await rate(page, 1, 3, ids[1], 'Hard', 2, 'second-hard');
    await rate(page, 2, 3, ids[2], 'Good', 3, 'third-good');
    await stage('mixed-completion-and-reload', async () => {
      await finish(page, 3);
      await stats(page, 2, 1, 33);
      await page.reload();
      await openDeck(page);
      await stats(page, 2, 1, 33);
      expect(await readDeck(context)).toEqual(deck);
    });
    const owner = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block', viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
    contexts.push(owner);
    const fresh = await owner.newPage();
    observe(fresh);
    await stage('fresh-owner-login-and-due-only-resumption', async () => {
      await authenticate(fresh, email, false);
      await fresh.goto(`/notebook/${notebookId}`);
      const response = await owner.request.get(`/api/notebooks/${notebookId}/sources`);
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect((data.sources || data).find((entry: Source) => entry.id === source.id).content).toBe(source.content);
      expect(await readDeck(owner)).toEqual(deck);
      await openDeck(fresh);
      await stats(fresh, 2, 1, 33);
      const due = deck.cards.filter(card => !card.nextReview || Date.parse(card.nextReview) <= Date.now()).map(card => card.id);
      receipt.resumedDueIds = due;
      persist();
      expect(due).toEqual(ids.slice(0, 2));
      await deckCard(fresh).getByRole('button', { name: /Review 2 Cards$/ }).click();
    });
    await rate(fresh, 0, 2, ids[0], 'Good', 3, 'resume-first-good');
    await rate(fresh, 1, 2, ids[1], 'Good', 3, 'resume-second-good');
    await stage('all-saved-progress-no-cards-due', async () => {
      await finish(fresh, 2);
      await stats(fresh, 0, 3, 60);
      await expect(deckCard(fresh).getByRole('button', { name: /No Cards Due$/ })).toBeDisabled();
      await fresh.reload();
      await openDeck(fresh);
      await stats(fresh, 0, 3, 60);
      await expect(deckCard(fresh).getByRole('button', { name: /No Cards Due$/ })).toBeDisabled();
      expect(await readDeck(owner)).toEqual(deck);
    });
    const foreign = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block', viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
    contexts.push(foreign);
    const outsider = await foreign.newPage();
    observe(outsider);
    await stage('foreign-account-denied-and-owner-record-unchanged', async () => {
      await authenticate(outsider, foreignEmail, true);
      await expect(outsider.locator(`a[href="/notebook/${notebookId}"]`)).toHaveCount(0);
      await outsider.goto(`/notebook/${notebookId}`);
      await expect(outsider.getByText(/Notebook not found/i).first()).toBeVisible();
      const statuses: number[] = [];
      for (const path of [`/api/notebooks/${notebookId}`, decksPath(), deckPath()]) {
        const response = await foreign.request.get(path);
        statuses.push(response.status());
        const body = await response.text();
        receipt.foreignDenial = { statuses: [...statuses], privateContentAbsent: !body.includes(deckName) && !deck.cards.some(card => body.includes(card.front) || body.includes(card.back)) };
        persist();
        expect([403, 404]).toContain(response.status());
        expect((receipt.foreignDenial as { privateContentAbsent: boolean }).privateContentAbsent).toBe(true);
      }
      const mutation = await foreign.request.put(deckPath(), { data: { expectedVersion: deck.version, cards: deck.cards } });
      statuses.push(mutation.status());
      receipt.foreignStatuses = statuses;
      persist();
      expect(new Set(statuses).size).toBe(1);
      expect([403, 404]).toContain(mutation.status());
      expect(await readDeck(owner)).toEqual(deck);
      receipt.finalDeck = deck;
    });
    receipt.phase = 'complete';
  } finally {
    collectingGenerationDiagnostics = false;
    if (diagnosticsEnabled) page.off('console', observeDiagnostic);
    persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
    await Promise.all(contexts.map(active => active.close()));
  }
});
