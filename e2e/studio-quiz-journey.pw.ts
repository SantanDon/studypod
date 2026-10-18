import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditCedarQuizAnswers } from './helpers/cedarFactOracle';
import type { Quiz, QuizHistory } from '../src/types/quiz.js';
import { content } from './full-flow-fixtures.mjs';

type QuizReceipt = Record<string, unknown> & {
  pageErrors: string[];
  providerRequests: { mode: 'server' | 'direct'; path: string; status: number; requestModel: unknown; modelUsed: unknown }[];
  stages: Record<string, { status: 'started' | 'passed' | 'failed'; startedAt: string; finishedAt?: string; error?: string }>;
};
type Source = { id: string; title: string; content: string; processingStatus: string };

// Dedicated local database only. No mocked sessions, model responses or persistence.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const knowledge = /(?:17|seventeen).*blue trays|(?:three|3).*seedlings|(?:six|6).*hours|chlorophyll|carbon dioxide|(?:fourteen|14).*days|same water.*no light/i;

function isCedarQuizRequest(request: Request, expectedURL: string): boolean {
  if (request.method() !== 'POST' || request.url() !== expectedURL) return false;
  try {
    const body = request.postDataJSON() as Record<string, unknown>;
    if (typeof body.prompt === 'string') return body.prompt.includes('You are an expert quiz creator') && body.prompt.includes(content);
    if (!Array.isArray(body.messages)) return false;
    const messages = body.messages as { role?: unknown; content?: unknown }[];
    return messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes('You are an expert quiz creator'))
      && messages.some(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes(content));
  } catch { return false; }
}


async function tab(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) >= 1100) return;
  const control = page.getByRole('tab', { name: new RegExp('(?:^|\\s)' + name + '$') });
  await expect(control).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
}

async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Cedar quiz ${randomUUID()}`);
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

async function openQuiz(page: Page) {
  await tab(page, 'Studio');
  const control = page.getByRole('button', { name: /^Quiz/ }).first();
  await expect(control).toBeVisible();
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
  await expect(page.getByRole('heading', { name: 'Quiz Settings', exact: true })).toBeVisible();
}

async function getList<T>(context: BrowserContext, path: string, key: string): Promise<T[]> {
  const response = await context.request.get(path);
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(Array.isArray(data[key])).toBe(true);
  return data[key];
}

async function verifyResults(page: Page, quiz: Quiz, answers: number[], score: number) {
  await expect(page.getByRole('heading', { name: 'Quiz Complete!', exact: true })).toBeVisible();
  await expect(page.getByText(`${score}%`, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Question Breakdown', exact: true })).toBeVisible();
  for (const [index, question] of quiz.questions.entries()) {
    await expect(page.getByText(`Q${index + 1}: ${question.question}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Your answer: ${question.options[answers[index]]}`, { exact: true }).first()).toBeVisible();
    if (answers[index] !== question.correctAnswer) {
      await expect(page.getByText(`Correct answer: ${question.options[question.correctAnswer]}`, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`💡 ${question.explanation}`, { exact: true }).first()).toBeVisible();
    }
  }
  await expect(page.getByRole('heading', { name: 'Areas to Improve', exact: true })).toHaveCount(score === 100 ? 0 : 1);
}

test('studio-quiz-journey: real Qwen completion, results, reload, retake, history and ownership', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(360_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
  const email = `quiz-${randomUUID()}@studypod.invalid`;
  const foreignEmail = `quiz-foreign-${randomUUID()}@studypod.invalid`;
  const sanitize = (value: unknown) => String(value).split(process.env.STUDYPOD_AUTH_PASSWORD!).join('[password]').split(email).join('[account]').split(foreignEmail).join('[account]').slice(0, 2000);
  const root = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
  mkdirSync(root, { recursive: true });
  const receipt: QuizReceipt = { target: testInfo.project.use.baseURL, mockedAuthOrData: false, phase: 'initializing', stages: {}, pageErrors: [], providerRequests: [] };
  const persist = () => writeFileSync(resolve(root, `${testInfo.project.name}-studio-quiz-journey.json`), JSON.stringify(receipt, null, 2));
  const observe = (observed: Page) => observed.on('pageerror', error => { receipt.pageErrors.push(sanitize(error.message)); persist(); });
  observe(page);
  async function stage(name: string, action: () => Promise<void>) {
    receipt.phase = name;
    receipt.stages[name] = { status: 'started', startedAt: new Date().toISOString() };
    persist();
    try {
      await test.step(name, action);
      Object.assign(receipt.stages[name], { status: 'passed', finishedAt: new Date().toISOString() });
    } catch (error) {
      Object.assign(receipt.stages[name], { status: 'failed', finishedAt: new Date().toISOString(), error: sanitize(error instanceof Error ? error.message : error) });
      throw error;
    } finally { persist(); }
  }
  let notebookId = '';
  let sourceId = '';
  let quiz!: Quiz;
  let savedAttempts: QuizHistory[] = [];
  const firstAnswers: number[] = [];
  const contexts: BrowserContext[] = [];
  const studioPath = () => `/api/notebooks/${notebookId}/studio`;
  async function completeQuiz(active: Page, answers: number[], prefix: string) {
    for (const [index, question] of quiz.questions.entries()) {
      await stage(`${prefix}-question-${index + 1}`, async () => {
        await expect(active.getByRole('heading', { name: question.question, exact: true })).toBeVisible();
        await expect(active.getByText(`${index + 1} / ${quiz.questions.length}`, { exact: true })).toBeVisible();
        await expect(active.getByRole('button', { name: 'Submit Answer', exact: true })).toBeDisabled();
        await expect(active.getByRole('button', { name: /^(Next Question|See Results)$/ })).toHaveCount(0);
        await active.getByRole('button', { name: new RegExp('^' + String.fromCharCode(65 + answers[index]) + '\\s') }).click();
        await expect(active.getByRole('button', { name: 'Submit Answer', exact: true })).toBeEnabled();
        await active.getByRole('button', { name: 'Submit Answer', exact: true }).click();
        await expect(active.getByRole('heading', { name: answers[index] === question.correctAnswer ? 'Correct!' : 'Explanation', exact: true })).toBeVisible();
        await expect(active.getByText(question.explanation, { exact: true }).first()).toBeVisible();
        await active.getByRole('button', { name: index === quiz.questions.length - 1 ? 'See Results' : 'Next Question', exact: true }).click();
      });
    }
  }
  try {
    await stage('signup-and-own-notebook', async () => {
      await authenticate(page, email, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
    });
    await stage('paste-source-and-process', async () => {
      await tab(page, 'Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      await page.getByRole('button', { name: /Pasted Content/ }).click();
      await page.getByLabel('Title', { exact: true }).fill('Cedar quiz journey');
      await page.getByLabel('Content', { exact: true }).fill(content);
      await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
        expect(response.status()).toBe(200);
        const data = await response.json();
        const sources = data.sources || data;
        const source = sources.find((entry: Source) => entry.title === 'Cedar quiz journey');
        if (source && /(?:17|seventeen) blue trays/i.test(source.content || '') && ['completed', 'degraded'].includes(source.processingStatus)) {
          sourceId = source.id;
          return true;
        }
        return false;
      }, { timeout: 60_000 }).toBe(true);
      receipt.sourceId = sourceId;
    });
    await stage('settle-source-background-generation', async () => {
      await page.reload();
      // Existing source pipeline schedules background inference within 45 seconds.
      // Release runner owns the exclusive provider slot; do not race that scheduled job.
      await page.waitForTimeout(46_000);
    });
    await stage('real-qwen-generation', async () => {
      await openQuiz(page);
      const settings = page.getByRole('heading', { name: 'Quiz Settings', exact: true }).locator('..').locator('..');
      await settings.getByRole('slider').focus();
      await settings.getByRole('slider').press('Home');
      await expect(settings.getByText('Number of Questions: 3', { exact: true })).toBeVisible();
      await settings.locator('label[for="difficulty-easy"]').click();
      const directMode = ['1', 'true'].includes(process.env.VITE_ENABLE_OLLAMA || '');
      const modelPicker = settings.getByRole('combobox');
      if (directMode) {
        // Visibility and the installed option prove actual discovery; no synthetic models.
        await expect(modelPicker, 'Enabled local discovery must expose the AI Model picker').toBeVisible();
        await modelPicker.click();
        await page.getByRole('option', { name: 'qwen3.5:9b', exact: true }).click();
      } else {
        await expect(modelPicker, 'Hosted inference must work with frontend discovery disabled').toHaveCount(0);
      }
      const apiBase = (process.env.VITE_API_URL || '/api').replace(/\/$/, '');
      const directBase = (process.env.VITE_OLLAMA_BASE_URL || process.env.VITE_OLLAMA_BASE || 'http://localhost:11434').replace(/\/$/, '');
      const expectedURL = new URL(directMode ? `${directBase}/api/generate` : `${apiBase}/ai/generate`, testInfo.project.use.baseURL).href;
      // Correlate the exact quiz prompt, origin/path and response. Background inference
      // or another notebook's POST cannot satisfy this provider assertion.
      const generated = page.waitForResponse(response => isCedarQuizRequest(response.request(), expectedURL), { timeout: 90_000 });
      await settings.getByRole('button', { name: /Start Quiz$/ }).click();
      const providerResponse = await generated;
      expect(providerResponse.status(), 'Actual quiz generation must receive provider acknowledgement').toBe(200);
      const responseBody = await providerResponse.json() as Record<string, unknown>;
      const requestBody = providerResponse.request().postDataJSON() as Record<string, unknown>;
      if (directMode) {
        expect(requestBody.model).toBe('qwen3.5:9b');
        expect(responseBody.model).toBe('qwen3.5:9b');
        expect(typeof responseBody.response).toBe('string');
        expect((responseBody.response as string).trim().length).toBeGreaterThan(0);
      } else {
        // The hosted API chooses its model on the server. Its returned modelUsed
        // is execution metadata; the browser cannot observe its downstream socket.
        expect(requestBody).not.toHaveProperty('model');
        expect(responseBody.modelUsed).toBe('qwen3.5:9b');
        expect(typeof responseBody.answer).toBe('string');
        expect((responseBody.answer as string).trim().length).toBeGreaterThan(0);
      }
      receipt.providerRequests.push({ mode: directMode ? 'direct' : 'server', path: new URL(expectedURL).pathname, status: providerResponse.status(), requestModel: requestBody.model ?? null, modelUsed: directMode ? responseBody.model : responseBody.modelUsed });
      persist();
      await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeVisible({ timeout: 90_000 });
      const quizzes = await getList<Quiz>(context, `${studioPath()}/quizzes`, 'quizzes');
      expect(quizzes).toHaveLength(1);
      quiz = quizzes[0];
      receipt.quiz = quiz; // Retain synthetic generated options even when the independent audit fails.
      persist();
      expect(quiz.notebookId).toBe(notebookId);
      expect(quiz.questions).toHaveLength(3);
      expect(quiz.difficulty).toBe('easy');
      expect(receipt.providerRequests).toHaveLength(1);
      for (const question of quiz.questions) {
        expect(question.sourceId).toBe(sourceId);
        expect(question.type).toBe('multiple_choice');
        expect(question.options).toHaveLength(4);
        expect(question.options.every(option => typeof option === 'string' && option.trim().length > 0)).toBe(true);
        expect(Number.isInteger(question.correctAnswer)).toBe(true);
        expect(question.correctAnswer).toBeGreaterThanOrEqual(0);
        expect(question.correctAnswer).toBeLessThan(4);
        expect(question.explanation.trim().length).toBeGreaterThan(0);
        expect(question.question).not.toMatch(/title|heading|how many sections|main topic/i);
        expect(`${question.question} ${question.options[question.correctAnswer]} ${question.explanation}`).toMatch(knowledge);
      }
      const factualAudit = auditCedarQuizAnswers(quiz.questions);
      expect(factualAudit, 'Every quiz question must have an independently supported answer').toHaveLength(quiz.questions.length);
      receipt.factualAudit = { audited: factualAudit.length, total: quiz.questions.length, questions: factualAudit, unauditedQuestionIds: quiz.questions.filter(question => !factualAudit.some(entry => entry.questionId === question.id)).map(question => question.id) };
      receipt.quiz = quiz; // Only synthetic Cedar material, for human semantic review.
      firstAnswers.push(...quiz.questions.map((question, index) => index === 0 ? (question.correctAnswer + 1) % 4 : question.correctAnswer));
    });
    await completeQuiz(page, firstAnswers, 'first-attempt');
    await stage('first-results-and-authoritative-save', async () => {
      await verifyResults(page, quiz, firstAnswers, 67);
      savedAttempts = await getList<QuizHistory>(context, `${studioPath()}/attempts`, 'attempts');
      expect(savedAttempts).toHaveLength(1);
      expect(savedAttempts[0].score).toBe(67);
      expect(savedAttempts[0].quizId).toBe(quiz.id);
      expect(savedAttempts[0].results?.map(result => result.selectedAnswer)).toEqual(firstAnswers);
      expect(savedAttempts[0].results?.map(result => result.isCorrect)).toEqual([false, true, true]);
      receipt.firstAttempt = savedAttempts[0];
      await page.getByRole('button', { name: 'Back to Studio', exact: true }).click();
      await page.reload();
      await openQuiz(page);
      await expect(page.locator('[aria-label="Quiz history"]').getByRole('button', { name: `View results: ${quiz.title} · 67%`, exact: true })).toBeEnabled();
      await page.locator('[aria-label="Saved quizzes"]').getByRole('button', { name: `Retake ${quiz.title}`, exact: true }).click();
      expect(await getList<QuizHistory>(context, `${studioPath()}/attempts`, 'attempts')).toHaveLength(1);
    });
    const correctAnswers = quiz.questions.map(question => question.correctAnswer);
    await completeQuiz(page, correctAnswers, 'retake');
    await stage('retake-results-and-independent-attempt', async () => {
      await verifyResults(page, quiz, correctAnswers, 100);
      savedAttempts = await getList<QuizHistory>(context, `${studioPath()}/attempts`, 'attempts');
      expect(savedAttempts).toHaveLength(2);
      expect(new Set(savedAttempts.map(attempt => attempt.id)).size).toBe(2);
      expect(savedAttempts.map(attempt => attempt.score).sort((a, b) => a - b)).toEqual([67, 100]);
      for (const attempt of savedAttempts) {
        expect(attempt.quizId).toBe(quiz.id);
        expect(attempt.totalQuestions).toBe(3);
        expect(attempt.results).toHaveLength(3);
        expect(attempt.results?.map(result => result.questionId)).toEqual(quiz.questions.map(question => question.id));
        expect(attempt.results?.every(result => Number.isFinite(result.timeSpent) && result.timeSpent >= 0)).toBe(true);
      }
      receipt.attempts = savedAttempts;
    });
    const freshOptions = { baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block' as const, viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch };
    await stage('fresh-login-and-history-results', async () => {
      const fresh = await browser.newContext(freshOptions); contexts.push(fresh);
      const owner = await fresh.newPage(); observe(owner);
      await authenticate(owner, email, false);
      expect(await getList<Quiz>(fresh, `${studioPath()}/quizzes`, 'quizzes')).toEqual([quiz]);
      expect(await getList<QuizHistory>(fresh, `${studioPath()}/attempts`, 'attempts')).toEqual(savedAttempts);
      await owner.goto(`/notebook/${notebookId}`);
      await openQuiz(owner);
      for (const attempt of [...savedAttempts].sort((a, b) => a.score - b.score)) {
        await owner.locator('[aria-label="Quiz history"]').getByRole('button', { name: `View results: ${quiz.title} · ${attempt.score}%`, exact: true }).click();
        await verifyResults(owner, quiz, attempt.score === 67 ? firstAnswers : correctAnswers, attempt.score);
        await owner.getByRole('button', { name: 'Back to Studio', exact: true }).click();
        await openQuiz(owner);
      }
      expect(await getList<QuizHistory>(fresh, `${studioPath()}/attempts`, 'attempts')).toEqual(savedAttempts);
    });
    await stage('foreign-account-read-and-write-denial', async () => {
      const foreign = await browser.newContext(freshOptions); contexts.push(foreign);
      const visitor = await foreign.newPage(); observe(visitor);
      await authenticate(visitor, foreignEmail, true);
      for (const path of [`${studioPath()}/quizzes`, `${studioPath()}/quizzes/${quiz.id}`, `${studioPath()}/attempts`, `/api/notebooks/${notebookId}/sources`]) {
        const response = await foreign.request.get(path);
        expect([403, 404]).toContain(response.status());
        const body = await response.text();
        expect(body).not.toContain(quiz.questions[0].question);
        expect(body).not.toMatch(/(?:17|seventeen) blue trays/i);
      }
      const denied = await foreign.request.post(`${studioPath()}/quizzes/${quiz.id}/attempts`, { data: { attemptId: randomUUID(), startedAt: new Date().toISOString(), results: quiz.questions.map(question => ({ questionId: question.id, selectedAnswer: question.correctAnswer, timeSpent: 1 })) } });
      expect([403, 404]).toContain(denied.status());
      expect(await getList<QuizHistory>(context, `${studioPath()}/attempts`, 'attempts')).toEqual(savedAttempts);
      receipt.ownership = { foreignReadsDenied: 4, foreignAttemptWriteDenied: true, ownerAttemptsUnchanged: true };
    });
    await stage('no-browser-exceptions', async () => { expect(receipt.pageErrors).toEqual([]); });
    receipt.phase = 'complete'; persist();
  } finally {
    for (const extra of contexts) await extra.close();
    persist();
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
