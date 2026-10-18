import { studioFailureDiagnostic, syntheticQuizDiagnostics } from './shared-account-studio-diagnostics.mjs';
import { sanitizeSharedErrors } from './shared-account-diagnostics.mjs';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { content } from './full-flow-fixtures.mjs';
import { createSharedFullPolicy } from './shared-account-full-policy.mjs';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { openSharedAccountLogin } from './shared-account-auth';
import { auditCedarQuizAnswers, cedarFactAnswer } from './helpers/cedarFactOracle';
import { supportedCedarConnection, type MapConnection } from './helpers/cedarMapOracle';
import { auditProseCard } from './source-prose-oracle.mjs';
import type { Quiz, QuizHistory } from '../src/types/quiz';
import type { FlashcardDeck } from '../src/types/flashcard';
import type { ConceptMap } from '../src/types/conceptMap';

interface SavedSource { id: string; title: string; processingStatus: string; content: string }
interface StudioReceipt {
  [key: string]: unknown;
  phase: string;
  cleanup: string;
  stages: Record<string, { status: string; startedAt: string; finishedAt?: string }>;
  checks: Record<string, boolean>;
  deniedRequests: { method: string; path: string; reason: string; quarantined: boolean }[];
}

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => { sanitizeSharedErrors(testInfo.errors); });

// Existing approved account only. Every mutation is restricted to this run's new notebook.
// Real generation and saved state; no provider, auth, or persistence responses are mocked.
async function read(page: Page, path: string) {
  return page.evaluate(async path => {
    const response = await fetch(path);
    return { status: response.status, body: response.ok ? await response.json() : null };
  }, path);
}
async function openTool(page: Page, name: RegExp) {
  const trigger = page.getByRole('button', { name }).first();
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}
async function openQuiz(page: Page, substep: (name: string) => void = () => {}) {
  substep('quiz-open-tool');
  await openTool(page, /^Quiz/);
  substep('quiz-settings-visible');
  await expect(page.getByRole('heading', { name: 'Quiz Settings', exact: true })).toBeVisible();
}
async function verifyResults(page: Page, quiz: Quiz, answers: number[], score: number) {
  await expect(page.getByRole('heading', { name: 'Quiz Complete!', exact: true })).toBeVisible();
  await expect(page.getByText(score + '%', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Question Breakdown', exact: true })).toBeVisible();
  for (const [index, question] of quiz.questions.entries()) {
    await expect(page.getByText('Q' + (index + 1) + ': ' + question.question, { exact: true })).toBeVisible();
    await expect(page.getByText('Your answer: ' + question.options[answers[index]], { exact: true }).first()).toBeVisible();
    if (answers[index] !== question.correctAnswer) {
      await expect(page.getByText('Correct answer: ' + question.options[question.correctAnswer], { exact: true }).first()).toBeVisible();
      await expect(page.getByText('💡 ' + question.explanation, { exact: true }).first()).toBeVisible();
    }
  }
  await expect(page.getByRole('heading', { name: 'Areas to Improve', exact: true })).toHaveCount(score === 100 ? 0 : 1);
}
async function completeQuiz(page: Page, quiz: Quiz, answers: number[]) {
  for (const [index, question] of quiz.questions.entries()) {
    await expect(page.getByRole('heading', { name: question.question, exact: true })).toBeVisible();
    await expect(page.getByText((index + 1) + ' / ' + quiz.questions.length, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: new RegExp('^' + String.fromCharCode(65 + answers[index]) + '\\s') }).click();
    await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
    await expect(page.getByRole('heading', { name: answers[index] === question.correctAnswer ? 'Correct!' : 'Explanation', exact: true })).toBeVisible();
    await expect(page.getByText(question.explanation, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: index === quiz.questions.length - 1 ? 'See Results' : 'Next Question', exact: true }).click();
  }
}
async function visibleMap(page: Page) {
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 120_000 });
  const labels = (await page.locator('.react-flow__node').allTextContents()).map(text => text.trim()).sort();
  const connections: MapConnection[] = await page.evaluate(() => {
    const nodes = new Map(Array.from(document.querySelectorAll('.react-flow__node')).map(node => [node.getAttribute('data-id'), node.textContent?.trim() || '']));
    return Array.from(document.querySelectorAll('.react-flow__edge')).map(edge => {
      const ids = /^Edge from (.+) to (.+)$/.exec(edge.getAttribute('aria-label') || '');
      return { source: nodes.get(ids?.[1] || '') || '', target: nodes.get(ids?.[2] || '') || '', label: edge.querySelector('.react-flow__edge-text')?.textContent?.trim() || '' };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  });
  expect(new Set(labels).size).toBeGreaterThanOrEqual(3);
  expect(connections.length).toBeGreaterThan(0);
  expect(connections.map((edge, index) => supportedCedarConnection(edge) ? null : index).filter(index => index !== null), 'Every generated relationship is independently grounded').toEqual([]);
  return { labels, connections };
}

test('shared Studio: grounded quiz retake, flashcard review, concept map and fresh login persistence', async ({ browser }, testInfo) => {
  const origin = validateSharedAccountEnvironment(process.env);
  const policy = createSharedFullPolicy(origin);
  const marker = 'Synthetic QA Studio ' + randomUUID();
  const artifactRoot = resolve(process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/release-20261018/shared-studio-live');
  mkdirSync(artifactRoot, { recursive: true });
  const receipt: StudioReceipt = { phase: 'login', origin, credentialsPersisted: false, mockedGeneration: false, scopeExcludesEncryptedSync: true, legacy106Eligible: false, deniedRequests: [], cleanup: 'not-created', stages: {}, checks: {} };
  const persist = () => writeFileSync(resolve(artifactRoot, 'studio-journey-receipt.json'), JSON.stringify(receipt, null, 2));
  const contexts: BrowserContext[] = [];
  const notebookListRequests: { method: 'GET'; status: number | null; failed: boolean }[] = [];
  receipt.notebookListRequests = notebookListRequests;
  const pageErrorClasses: string[] = [];
  const nativeErrorClasses = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError']);
  let cleanupPage: Page | undefined;
  let notebookId = '';
  const studio = () => '/api/notebooks/' + notebookId + '/studio';
  async function list<T>(page: Page, path: string, key: string): Promise<T[]> {
    const result = await read(page, path);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body?.[key])).toBe(true);
    return result.body[key];
  }
  const substep = (name: string) => { receipt.substep = name; persist(); };
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name;
    receipt.substep = 'stage-action';
    receipt.stages[name] = { status: 'started', startedAt: new Date().toISOString() };
    persist();
    try { await test.step(name, action); receipt.stages[name].status = 'passed'; }
    catch (error) {
      receipt.stages[name].status = 'failed';
      receipt.failure = studioFailureDiagnostic(error, receipt.substep);
      throw error;
    }
    finally { receipt.stages[name].finishedAt = new Date().toISOString(); persist(); }
  }
  async function fresh() {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', async route => {
      const request = route.request();
      const decision = policy.decide(request.url(), request.method());
      if (!decision.allowed) {
        receipt.deniedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, reason: decision.reason, quarantined: decision.quarantined === true });
        await route.abort('blockedbyclient'); return;
      }
      if (decision.captureCreated) {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() === 201) { policy.registerCreated((await response.json()).id); receipt.cleanup = 'pending'; }
        await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    const page = await openSharedAccountLogin(context, origin);
    page.on('pageerror', error => {
      // Retain only bounded native class labels, never messages, stacks, or URLs.
      pageErrorClasses.push(nativeErrorClasses.has(error.name) ? error.name : 'OtherError');
      if (pageErrorClasses.length > 10) pageErrorClasses.shift();
    });
    const isNotebookList = (url: string, method: string) => {
      const parsed = new URL(url);
      return parsed.origin === origin && parsed.pathname === '/api/notebooks' && method === 'GET';
    };
    page.on('response', response => {
      if (isNotebookList(response.url(), response.request().method())) {
        notebookListRequests.push({ method: 'GET', status: response.status(), failed: false });
        if (notebookListRequests.length > 20) notebookListRequests.shift();
        persist();
      }
    });
    page.on('requestfailed', request => {
      if (isNotebookList(request.url(), request.method())) {
        notebookListRequests.push({ method: 'GET', status: null, failed: true });
        if (notebookListRequests.length > 20) notebookListRequests.shift();
        persist();
      }
    });
    await page.getByLabel('Email Address').fill(process.env.STUDYPOD_SHARED_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_SHARED_PASSWORD!);
    const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/signin' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signedIn).status()).toBe(200);
    await page.waitForURL(url => url.pathname === '/');
    const profile = await read(page, '/api/user/profile');
    expect(profile.status).toBe(200);
    expect(profile.body?.user?.email === process.env.STUDYPOD_SHARED_EMAIL, 'Approved existing identity verified at runtime').toBe(true);
    policy.verifyIdentity();
    return page;
  }
  let quiz!: Quiz;
  let attempts: QuizHistory[] = [];
  let deck!: FlashcardDeck;
  let source!: SavedSource;
  let mapSnapshot: Awaited<ReturnType<typeof visibleMap>>;
  let savedMap!: ConceptMap;
  try {
    const page = await fresh(); cleanupPage = page;
    await stage('owned-notebook-and-real-pasted-source', async () => {
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/notebooks' && response.request().method() === 'POST');
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      expect((await created).status()).toBe(201);
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      expect(policy.ids()).toEqual([notebookId]); receipt.notebookId = notebookId;
      const rename = await page.evaluate(async ({ id, title }) => {
        const response = await fetch('/api/notebooks/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
        const status = response.status;
        // Only fixed HTTP categories leave the browser; never retain response content.
        const errorCategory = status === 200 ? null
          : status === 401 ? 'unauthorized'
          : status === 403 ? 'forbidden'
          : status === 404 ? 'not-found'
          : status >= 500 && status <= 599 ? 'server-error'
          : status >= 400 && status <= 499 ? 'client-error'
          : 'unexpected-status';
        return { status, errorCategory };
      }, { id: notebookId, title: marker });
      receipt.notebookRename = rename;
      persist();
      expect(rename.status).toBe(200);
      substep('owned-notebook-ready');
      const addSource = page.getByRole('button', { name: /^(?:Add|Add a source)$/ }).first();
      try { await addSource.click(); }
      catch (error) {
        receipt.notebookReadiness = {
          pageClosed: page.isClosed(),
          urlIsOwnedNotebook: !page.isClosed() && new URL(page.url()).origin === origin && new URL(page.url()).pathname === '/notebook/' + notebookId,
          routeLoading: await page.getByText('Loading StudyPod…', { exact: true }).isVisible().catch(() => false),
          loading: await page.getByText('Loading notebook...', { exact: true }).isVisible().catch(() => false),
          notFound: await page.getByRole('heading', { name: 'Notebook Not Found', exact: true }).isVisible().catch(() => false),
          ownedNotebookTitle: await page.getByRole('button', { name: 'Edit notebook title: ' + marker, exact: true }).isVisible().catch(() => false),
          applicationError: await page.getByRole('heading', { name: 'Application Error', exact: true }).isVisible().catch(() => false),
          sourcesError: await page.getByRole('heading', { name: 'Sources Error', exact: true }).isVisible().catch(() => false),
          moduleLoadError: await page.getByRole('heading', { name: 'Part of StudyPod could not load', exact: true }).isVisible().catch(() => false),
          addVisible: await addSource.isVisible().catch(() => false),
          pageErrorClasses: [...pageErrorClasses],
          moduleTiming: await page.evaluate(() => {
            // Aggregate same-origin module timings without returning resource names.
            const groups = { app: { count: 0, maxDurationMs: 0 }, dependency: { count: 0, maxDurationMs: 0 } };
            for (const entry of performance.getEntriesByType('resource')) {
              const url = new URL(entry.name, location.origin);
              if (url.origin !== location.origin) continue;
              const group = url.pathname.startsWith('/src/') && /\.[jt]sx?$/.test(url.pathname) ? groups.app
                : url.pathname.startsWith('/node_modules/.vite/deps/') && url.pathname.endsWith('.js') ? groups.dependency : null;
              if (!group) continue;
              group.count++;
              group.maxDurationMs = Math.max(group.maxDurationMs, Math.round(entry.duration));
            }
            return groups;
          }).catch(() => null),
          notebookListRequests: notebookListRequests.map(entry => ({ ...entry })),
        };
        persist();
        throw error;
      }
      await page.getByRole('button', { name: /Pasted Content/ }).click();
      await page.getByLabel('Title', { exact: true }).fill(marker);
      await page.getByLabel('Content', { exact: true }).fill(content);
      await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      await expect.poll(async () => {
        const result = await read(page, '/api/notebooks/' + notebookId + '/sources');
        const sources = Array.isArray(result.body) ? result.body : result.body?.sources || [];
        source = sources.find((candidate: SavedSource) => candidate.title === marker && ['completed', 'degraded'].includes(candidate.processingStatus) && /17 blue trays/i.test(candidate.content || ''));
        return !!source;
      }, { timeout: 180_000, message: 'Saved real source retains synthetic facts' }).toBe(true);
      receipt.sourceId = source.id;
      await page.reload();
      receipt.checks.sourcePersisted = true;
    });
    await stage('real-quiz-generation-and-independent-answer-audit', async () => {
      await openQuiz(page, substep);
      const settings = page.getByRole('heading', { name: 'Quiz Settings', exact: true }).locator('..').locator('..');
      substep('quiz-count-control');
      await settings.getByRole('slider').focus(); await page.keyboard.press('Home');
      substep('quiz-count-confirmed');
      await expect(settings.getByText('Number of Questions: 3', { exact: true })).toBeVisible();
      substep('quiz-difficulty-control');
      await settings.locator('label[for="difficulty-easy"]').click();
      substep('quiz-start-generation');
      await settings.getByRole('button', { name: /Start Quiz$/ }).click();
      substep('quiz-generated-question-visible');
      await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeVisible({ timeout: 180_000 });
      substep('quiz-persisted-record');
      const quizzes = await list<Quiz>(page, studio() + '/quizzes', 'quizzes');
      expect(quizzes).toHaveLength(1); quiz = quizzes[0];
      substep('quiz-shape-audit');
      expect(quiz.questions).toHaveLength(3); expect(quiz.difficulty).toBe('easy');
      for (const question of quiz.questions) {
        expect(question.type).toBe('multiple_choice'); expect(question.sourceId).toBe(source.id);
        expect(question.options).toHaveLength(4); expect(question.options.every(option => option.trim().length > 0)).toBe(true);
        expect(question.explanation.trim()).not.toBe('');
      }
      substep('quiz-independent-answer-audit');
      // The owned notebook and all question source IDs were verified above.
      expect(policy.ids()).toEqual([notebookId]);
      expect(source.title).toBe(marker);
      receipt.syntheticQuizAudit = syntheticQuizDiagnostics(quiz.questions, cedarFactAnswer);
      persist();
      const audits = auditCedarQuizAnswers(quiz.questions);
      expect(audits).toHaveLength(3);
      receipt.quiz = { id: quiz.id, independentlyAuditedQuestions: audits.length };
    });
    const firstAnswers = quiz.questions.map((question, index) => index === 0 ? (question.correctAnswer + 1) % 4 : question.correctAnswer);
    const correctAnswers = quiz.questions.map(question => question.correctAnswer);
    await stage('quiz-answer-feedback-score-and-saved-attempt', async () => {
      await completeQuiz(page, quiz, firstAnswers);
      await verifyResults(page, quiz, firstAnswers, 67);
      attempts = await list<QuizHistory>(page, studio() + '/attempts', 'attempts');
      expect(attempts).toHaveLength(1); expect(attempts[0].score).toBe(67);
      expect(attempts[0].results?.map(result => result.selectedAnswer)).toEqual(firstAnswers);
      expect(attempts[0].results?.map(result => result.isCorrect)).toEqual([false, true, true]);
    });
    await stage('quiz-reload-retake-and-independent-attempt', async () => {
      await page.getByRole('button', { name: 'Back to Studio', exact: true }).click();
      await page.reload(); await openQuiz(page);
      await expect(page.locator('[aria-label="Quiz history"]').getByRole('button', { name: 'View results: ' + quiz.title + ' · 67%', exact: true })).toBeEnabled();
      await page.locator('[aria-label="Saved quizzes"]').getByRole('button', { name: 'Retake ' + quiz.title, exact: true }).click();
      expect(await list<QuizHistory>(page, studio() + '/attempts', 'attempts')).toHaveLength(1);
      await completeQuiz(page, quiz, correctAnswers); await verifyResults(page, quiz, correctAnswers, 100);
      attempts = await list<QuizHistory>(page, studio() + '/attempts', 'attempts');
      expect(attempts).toHaveLength(2); expect(new Set(attempts.map(attempt => attempt.id)).size).toBe(2);
      expect(attempts.map(attempt => attempt.score).sort((a, b) => a - b)).toEqual([67, 100]);
      for (const attempt of attempts) {
        expect(attempt.quizId).toBe(quiz.id); expect(attempt.totalQuestions).toBe(3);
        expect(attempt.results?.map(result => result.questionId)).toEqual(quiz.questions.map(question => question.id));
        expect(attempt.results?.every(result => Number.isFinite(result.timeSpent) && result.timeSpent >= 0)).toBe(true);
      }
      receipt.checks.quizAnswerRetakeHistory = true;
      await page.getByRole('button', { name: 'Back to Studio', exact: true }).click();
    });
    await stage('real-flashcard-generation-and-source-grounding', async () => {
      await openTool(page, /^Flashcards/);
      await page.getByRole('button', { name: /(?:^|\s)New Deck$/ }).click();
      await page.getByPlaceholder('Deck name...').fill(marker);
      await page.getByRole('button', { name: /(?:^|\s)Create Deck$/ }).click();
      await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
      await page.getByRole('button', { name: /(?:^|\s)Generate$/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Generate Flashcards', exact: true })).toBeVisible();
      for (const [index, name] of [marker, source.title, '3 cards'].entries()) {
        await dialog.getByRole('combobox').nth(index).click();
        await page.getByRole('option', { name, exact: true }).click();
      }
      await dialog.getByRole('button', { name: /(?:^|\s)Generate Cards$/ }).click();
      await expect.poll(async () => {
        deck = (await list<FlashcardDeck>(page, studio() + '/decks', 'decks')).find(candidate => candidate.name === marker)!;
        return deck?.cards.length;
      }, { timeout: 180_000 }).toBe(3);
      const audits = deck.cards.map(card => auditProseCard({ card, source, profile: 'cedar', authorizedSourceIds: [source.id] }));
      expect(audits.map(audit => audit.outcome)).toEqual(Array(3).fill('independently-supported'));
      receipt.deck = { id: deck.id, independentlyAuditedCards: audits.length };
    });
    await stage('flashcard-reveal-rating-and-saved-scheduling', async () => {
      await page.getByRole('button', { name: /Review 3 Cards$/ }).click();
      for (const [index, label] of ['Again', 'Hard', 'Good'].entries()) {
        const before = structuredClone(deck); const original = before.cards[index];
        await expect(page.getByText('Card ' + (index + 1) + ' of 3', { exact: true })).toBeVisible();
        const reveal = page.getByRole('button', { name: 'Reveal answer', exact: true });
        await expect(reveal.getByText(original.front, { exact: true })).toBeVisible(); await reveal.click();
        const rotation = page.locator('[style*="preserve-3d"]');
        await expect(rotation).toHaveCount(1);
        await expect.poll(() => rotation.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m11 < -0.98)).toBe(true);
        await expect(rotation.getByText(original.back, { exact: true })).toBeVisible();
        const acknowledged = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === studio() + '/decks/' + deck.id);
        await page.getByRole('button', { name: new RegExp('(?:^|\\s)' + label + '$') }).click();
        const response = await acknowledged; expect(response.status()).toBe(200);
        deck = (await response.json()).deck;
        expect(deck.version).toBe(before.version! + 1);
        const rated = deck.cards.find(card => card.id === original.id)!;
        expect({ front: rated.front, back: rated.back, sourceId: rated.sourceId }).toEqual({ front: original.front, back: original.back, sourceId: source.id });
        expect(rated.correctCount).toBe(original.correctCount + (label === 'Good' ? 1 : 0));
        expect(rated.incorrectCount).toBe(original.incorrectCount + (label === 'Good' ? 0 : 1));
        expect(rated.interval).toBe(label === 'Good' ? 1 : 0);
        expect(Number.isFinite(Date.parse(rated.lastReviewed!))).toBe(true);
        expect(Date.parse(rated.nextReview!)).toBeGreaterThanOrEqual(Date.parse(rated.lastReviewed!));
        expect(deck.cards.filter(card => card.id !== original.id)).toEqual(before.cards.filter(card => card.id !== original.id));
        const saved = await read(page, studio() + '/decks/' + deck.id); expect(saved.status).toBe(200); expect(saved.body.deck).toEqual(deck);
      }
      await expect(page.getByRole('heading', { name: 'Session Complete!', exact: true })).toBeVisible();
      await expect(page.getByText('You reviewed 3 cards.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /(?:^|\s)Done$/ }).click();
      receipt.checks.flashcardRevealRatingScheduling = true;
    });
    await stage('real-concept-map-and-directed-relationship-audit', async () => {
      await openTool(page, /Concept Map/);
      await page.getByRole('button', { name: 'Generate map', exact: true }).click();
      mapSnapshot = await visibleMap(page);
      const maps = await list<ConceptMap>(page, studio() + '/maps', 'maps'); expect(maps).toHaveLength(1);
      const result = await read(page, studio() + '/maps/' + maps[0].id); expect(result.status).toBe(200); savedMap = result.body.map;
      receipt.map = { id: maps[0].id, nodes: mapSnapshot.labels.length, independentlyAuditedRelationships: mapSnapshot.connections.length };
      await page.reload(); await openTool(page, /Concept Map/); expect(await visibleMap(page)).toEqual(mapSnapshot);
      receipt.checks.mapReload = true;
    });
    await stage('fresh-login-restores-quiz-deck-map-and-results', async () => {
      const owner = await fresh(); cleanupPage = owner;
      await owner.goto('/notebook/' + notebookId);
      expect(await list<Quiz>(owner, studio() + '/quizzes', 'quizzes')).toEqual([quiz]);
      expect(await list<QuizHistory>(owner, studio() + '/attempts', 'attempts')).toEqual(attempts);
      const savedDeck = await read(owner, studio() + '/decks/' + deck.id); expect(savedDeck.status).toBe(200); expect(savedDeck.body.deck).toEqual(deck);
      const map = await read(owner, studio() + '/maps/' + savedMap.id); expect(map.status).toBe(200); expect(map.body.map).toEqual(savedMap);
      await openQuiz(owner);
      for (const attempt of [...attempts].sort((a, b) => a.score - b.score)) {
        await owner.locator('[aria-label="Quiz history"]').getByRole('button', { name: 'View results: ' + quiz.title + ' · ' + attempt.score + '%', exact: true }).click();
        await verifyResults(owner, quiz, attempt.score === 67 ? firstAnswers : correctAnswers, attempt.score);
        await owner.getByRole('button', { name: 'Back to Studio', exact: true }).click();
      }
      expect(await list<QuizHistory>(owner, studio() + '/attempts', 'attempts')).toEqual(attempts);
      await openTool(owner, /^Flashcards/);
      await expect(owner.getByRole('heading', { name: marker, exact: true })).toBeVisible();
      await expect(owner.getByRole('button', { name: /Review 2 Cards$/ })).toBeVisible();
      await openTool(owner, /Concept Map/); expect(await visibleMap(owner)).toEqual(mapSnapshot);
      receipt.checks.freshContextPersistence = true;
    });
    receipt.phase = 'passed';
  } finally {
    const ownedId = notebookId || policy.ids()[0];
    if (ownedId && cleanupPage && !cleanupPage.isClosed()) {
      try {
        const removed = await cleanupPage.evaluate(async id => (await fetch('/api/notebooks/' + id, { method: 'DELETE' })).status, ownedId);
        const absent = await read(cleanupPage, '/api/notebooks/' + ownedId);
        receipt.cleanup = removed >= 200 && removed < 300 && absent.status === 404 ? 'verified-deleted' : 'retained-QA-notebook';
      } catch { receipt.cleanup = 'retained-QA-notebook'; }
    }
    persist();
    await testInfo.attach('shared-account-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
    for (const context of contexts) await context.close();
  }
  expect(receipt.cleanup, 'Only this run owned QA notebook is removed').toBe('verified-deleted');
  expect(receipt.deniedRequests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.quarantined), 'No unexpected forbidden mutation was attempted; encrypted sync remains physically blocked').toEqual([]);
});
