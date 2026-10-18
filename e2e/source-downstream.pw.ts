import { assertFreshConversation, selectNewAssistant, checkYouTube, sha256, publicYouTubeReceipt } from './youtube-response-acceptance.mjs';
import { ratioDiagnosticPrefix, ratioDiagnosticsEnabled, parseRatioDiagnostic, type SafeRatioDiagnostic } from './flashcard-ratio-diagnostics';
import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Response, type ConsoleMessage } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { content } from './full-flow-fixtures.mjs';
import { auditProseCard } from './source-prose-oracle.mjs';
import { formatDisplayTitle } from '../src/lib/utils/displayTitle.js';

// Real isolated acceptance only: no route interception, forged sessions or model responses.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const formats = ['txt', 'md', 'markdown', 'pdf', 'docx', 'epub', 'wav', 'mp3', 'm4a', 'bookmarks', 'bookmarks-js', 'paste', 'website', 'youtube'];
const trayFact = /(?:17|seventeen) blue trays/i;
interface SavedSource { id: string; title: string; type: string; content: string; processingStatus: string; metadata?: unknown }
interface SavedCard { front: string; back: string; sourceId: string; correctCount: number }
interface SavedDeck { id: string; name: string; cards: SavedCard[] }
interface SavedMessage { role: string; content: string; groundedSources?: unknown; grounded_sources?: unknown }
interface SavedCitation { citation_id: number; source_id: string; excerpt: string; prefetched_content?: string }
interface DownstreamReceipt {
  [key: string]: unknown;
  phase: string;
  pageErrors: string[];
  stages: Record<string, { status: string; error?: string; reloadViewerFact?: boolean }>;
  generatedCards?: { front: string; back: string; sourceId: string }[];
}


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

// Observation only: no interception, generated-response substitution or generation retries.
function safeGenerationError(message: string) {
  const fixed = [
    ['NO_GROUNDED_CARDS', 'No grounded source-completion flashcards were returned; try a clearer source passage'],
    ['SOURCE_TOO_SHORT', 'Content is too short to generate flashcards'],
    ['SOURCE_EMPTY', 'Selected source has no content'],
    ['PROVIDER_UNAVAILABLE', 'No server AI provider'],
    ['AI_GENERATION_FAILED', 'AI generation failed'],
  ] as const;
  const known = fixed.find(([, text]) => message.includes(text));
  return {
    code: known?.[0] ?? 'UNCLASSIFIED_GENERATION_ERROR',
    ...(known ? { fixedMessage: known[1] } : {}),
    messageLength: message.length,
    sha256: createHash('sha256').update(message).digest('hex'),
  };
}
async function safeGenerationResponse(response: Response, kind: 'generate' | 'deck-save') {
  const result: Record<string, unknown> = { kind, method: response.request().method(), status: response.status() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Read once, bounded; raw bodies stay in memory and never enter public receipts.
    const body = await Promise.race([
      response.body(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('BODY_READ_TIMEOUT')), 8_000); }),
    ]);
    result.bodyBytes = body.byteLength;
    result.bodySha256 = createHash('sha256').update(body).digest('hex');
    try {
      const payload: unknown = JSON.parse(body.toString('utf8'));
      if (payload && typeof payload === 'object') {
        const value = payload as { answer?: unknown; response?: unknown; error?: unknown; code?: unknown };
        const answer = typeof value.answer === 'string' ? value.answer : typeof value.response === 'string' ? value.response : undefined;
        if (answer !== undefined) {
          result.answerLength = answer.length;
          result.answerSha256 = createHash('sha256').update(answer).digest('hex');
        }
        if (typeof value.error === 'string') result.error = safeGenerationError(value.error);
        if (typeof value.code === 'string' && ['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'VALIDATION_ERROR', 'UNAUTHORIZED'].includes(value.code)) result.safeCode = value.code;
      }
    } catch { result.bodyFormat = 'non-json'; }
  } catch (error) {
    result.bodyRead = error instanceof Error && error.message === 'BODY_READ_TIMEOUT' ? 'timeout' : 'unavailable';
  } finally { if (timer) clearTimeout(timer); }
  return result;
}

function normalizeEvidence(text: string) { return text.replace(/\s+/g, ' ').trim().toLowerCase(); }

function messageCitations(message: SavedMessage): SavedCitation[] {
  const raw = message.groundedSources ?? message.grounded_sources;
  const metadata: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  expect(metadata).toBeTruthy();
  expect(typeof metadata).toBe('object');
  const envelope = metadata as { version?: unknown; citations?: unknown };
  expect(envelope.version).toBe(1);
  expect(Array.isArray(envelope.citations)).toBe(true);
  return envelope.citations as SavedCitation[];
}

async function tab(page: Page, name: string) {
  // Notebook uses tabs below its 1100px desktop breakpoint. Do not infer
  // desktop from an empty locator while the mobile notebook is still mounting.
  const viewport = page.viewportSize();
  expect(viewport, 'Acceptance navigation requires a configured viewport').not.toBeNull();
  if (viewport!.width >= 1100) return;
  const control = page.getByRole('tab', { name: new RegExp('(?:^|\\s)' + name + '$') });
  await expect(control).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

function sourceTitle(page: Page, title: string) {
  // Match the SourcesSidebar card title, excluding notebook headings and viewer text.
  return page.locator('span.text-sm.font-medium').and(page.getByText(formatDisplayTitle(title, 'Untitled source'), { exact: true }));
}

async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Cedar downstream ${randomUUID()}`);
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

async function savedSources(context: BrowserContext, id: string) {
  const response = await context.request.get(`/api/notebooks/${id}/sources`);
  expect(response.status()).toBe(200);
  const data = await response.json();
  const sources = data.sources || data;
  expect(Array.isArray(sources)).toBe(true);
  return sources as SavedSource[];
}

for (const format of formats) {
  test(`source-downstream-${format}: intake, cited chat, generated Studio, ownership`, async ({ page, context, browser }, testInfo) => {
    const publicSource = format === 'website' || format === 'youtube';
    const retainedFact = format === 'youtube' ? /glucose/i : format === 'website' ? /carbon dioxide/i : trayFact;
    const answerFact = publicSource ? retainedFact : /(?:17|seventeen)(?:\s+\w+){0,3}\s+trays/i;
    const sourceUrl = format === 'website' ? 'https://en.wikipedia.org/wiki/Photosynthesis' : format === 'youtube' ? 'https://www.youtube.com/watch?v=eo5XndJaz-Y' : undefined;
    const question = format === 'youtube'
      ? 'According to this photosynthesis video transcript, which sugar do plants produce? Name the sugar and cite the source.'
      : format === 'website'
        ? 'According to this photosynthesis article, which gas do plants take in as a reactant? Name the gas and cite the source.'
        : 'According to the Cedar experiment source, exactly how many blue trays are used? Give the number and cite the source.';
    test.setTimeout(360_000);
    expect(process.env.STUDYPOD_FULL_ISOLATED, 'Use the dedicated isolated full-flow database').toBe('1');
    expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
    expect(testInfo.project.use.baseURL, 'Never run against shared 4179/3001 or cloud implicitly').toBe('http://127.0.0.1:4182');
    expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
    expect(process.env.STUDYPOD_FULL_FIXTURES).toBeTruthy();
    expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
    const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
    mkdirSync(artifactRoot, { recursive: true });
    const receipt: DownstreamReceipt = { format, sourceUrl, target: testInfo.project.use.baseURL, mockedAuthOrData: false, stages: {}, phase: 'authentication', pageErrors: [], studioPersistence: 'authoritative server deck, owner fresh-browser login and foreign-account denial required' };
    let savedDeckId: string | undefined;
    const publicReceipt = () => format === 'youtube' ? publicYouTubeReceipt(receipt) : receipt;
    const persist = () => writeFileSync(resolve(artifactRoot, `${testInfo.project.name}-source-downstream-${format}.json`), JSON.stringify(publicReceipt(), null, 2));
    page.on('pageerror', error => receipt.pageErrors.push(error.message.slice(0, 500)));
    let preUploadBoundary = true;
    const publicLifecycle: { event: string; resource?: string; status?: number; elapsedMs: number }[] = [];
    const boundaryStarted = Date.now();
    const recordPublic = (event: string, resource?: string, status?: number) => {
      if (!preUploadBoundary) return;
      if (publicLifecycle.length === 120) publicLifecycle.shift();
      publicLifecycle.push({ event, resource, status, elapsedMs: Date.now() - boundaryStarted });
    };
    const publicResource = (request: import('@playwright/test').Request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return 'main-document';
      const pathname = new URL(request.url()).pathname;
      if (!/^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(pathname)) return undefined;
      if (/^\/assets\/documentProcessor-/.test(pathname)) return 'document-processor-script';
      return pathname.endsWith('.css') ? 'stylesheet' : 'application-script';
    };
    page.on('request', request => { const resource = publicResource(request); if (resource) recordPublic('request', resource); });
    page.on('response', response => { const resource = publicResource(response.request()); if (resource) recordPublic('response', resource, response.status()); });
    page.on('requestfinished', request => { const resource = publicResource(request); if (resource) recordPublic('finished', resource); });
    page.on('requestfailed', request => { const resource = publicResource(request); if (resource) recordPublic('failed', resource); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) recordPublic('main-document-committed'); });
    page.on('domcontentloaded', () => recordPublic('document-domcontentloaded'));
    async function attachPreUploadDiagnostics() {
      // Only structural counts and fixed allowlisted labels leave the page.
      const documentState = await page.evaluate(() => {
        const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
        const allowedName = (name: string) => {
          if (/^(?:[\uE000-\uF8FF]\s*)?Add$/.test(name)) return 'Add';
          if (/^(?:[\uE000-\uF8FF]\s*)?Add a source$/.test(name)) return 'Add a source';
          return undefined;
        };
        const addButtonNames = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible)
          .map(element => allowedName((element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ')))
          .filter((name): name is 'Add' | 'Add a source' => Boolean(name)).slice(0, 20);
        const root = document.getElementById('root');
        return { documentPresent: Boolean(document.documentElement), bodyPresent: Boolean(document.body), readyState: document.readyState,
          rootPresent: Boolean(root), rootChildCount: root?.childElementCount || 0, addButtonNames };
      }).catch(() => ({ documentObservationUnavailable: true }));
      const heading = page.getByRole('heading', { name: 'Sources', exact: true });
      let visibleSourcesHeadingCount = 0;
      for (let index = 0; index < await heading.count().catch(() => 0); index++) {
        if (await heading.nth(index).isVisible().catch(() => false)) visibleSourcesHeadingCount++;
      }
      await testInfo.attach('source-pre-upload-diagnostics-public', { body: Buffer.from(JSON.stringify({
        boundary: 'before opening source intake', documentState, visibleSourcesHeadingCount, lifecycle: publicLifecycle,
      }, null, 2)), contentType: 'application/json' });
    }
    const extractionResponses: { path: string; status: number }[] = [];
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (['/api/proxy/extract-web', '/api/youtube/youtube-transcript', '/api/youtube-edge'].includes(path)) {
        extractionResponses.push({ path, status: response.status() });
      }
    });
    const downstreamFailures: string[] = [];
    async function stage(name: string, action: () => Promise<void>) {
      receipt.phase = name; persist();
      try { await test.step(name, action); receipt.stages[name] = { status: 'passed' }; }
      catch (error) {
        receipt.stages[name] = { status: 'failed', error: error instanceof Error ? error.message.slice(0, 1800) : String(error) };
        downstreamFailures.push(name);
      }
      persist();
    }
    try {
      const email = `downstream-${randomUUID()}@studypod.invalid`;
      await authenticate(page, email, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      const id = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = id;
      receipt.phase = 'intake'; persist();
      await tab(page, 'Sources');
      await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /^(?:Add|Add a source)$/ }).first().click();
      preUploadBoundary = false;
      if (format === 'paste') {
        await page.getByRole('button', { name: /Pasted Content/ }).click();
        await page.getByLabel('Title', { exact: true }).fill('Cedar pasted downstream');
        await page.getByLabel('Content', { exact: true }).fill(content);
        await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      } else if (format === 'website') {
        await page.getByRole('button', { name: /Website URLs/ }).click();
        await page.getByPlaceholder(/Enter URLs one per line/).fill(sourceUrl!);
        await page.getByRole('button', { name: 'Add 1 Website', exact: true }).click();
      } else if (format === 'youtube') {
        await page.getByRole('button', { name: /YouTube Ingestion/ }).click();
        await page.getByLabel('YouTube video URL').fill(sourceUrl!);
        await page.getByLabel('Preferred transcript language').fill('en');
        await page.getByRole('dialog').getByRole('button', { name: 'Add Source', exact: true }).click();
      } else if (format === 'bookmarks' || format === 'bookmarks-js') {
        await page.getByRole('button', { name: /Bookmarks & Tweets/ }).click();
        await page.getByRole('tab', { name: /Twitter Archive JS\/JSON/ }).click();
        const archiveEntries = JSON.stringify([{ tweetId: '1234567890123456789', user: { screen_name: 'cedarqa', name: 'Cedar QA' }, text: content }]);
        const javascriptArchive = format === 'bookmarks-js';
        const archiveName = javascriptArchive ? 'cedar-bookmarks.js' : 'cedar-bookmarks.json';
        const archiveContent = javascriptArchive ? `window.YTD.bookmark.part0 = ${archiveEntries};` : archiveEntries;
        const chooser = page.waitForEvent('filechooser');
        await page.getByText('Drag and drop your bookmarks export here', { exact: true }).click();
        await (await chooser).setFiles({ name: archiveName, mimeType: javascriptArchive ? 'application/javascript' : 'application/json', buffer: Buffer.from(archiveContent) });
        receipt.visibleFileChooser = true;
        await expect(page.getByText(archiveName, { exact: true })).toBeVisible();
        await expect(page.getByText('1 bookmark found', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import Archive', exact: true })).toBeEnabled();
        const imported = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/notebooks/${id}/sources/tweets`), { timeout: 120_000 });
        await page.getByRole('button', { name: /Import Archive/ }).click();
        const response = await imported;
        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.processed).toBeGreaterThan(0);
        expect(result.totalSources).toBe(1);
        expect(result.errors || []).toEqual([]);
        receipt.bookmarkImport = { processed: result.processed, totalSources: result.totalSources };
      } else {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await (await chooser).setFiles(resolve(process.env.STUDYPOD_FULL_FIXTURES!, `cedar.${format}`));
        receipt.visibleFileChooser = true;
      }
      let source!: SavedSource;
      try {
        await expect.poll(async () => {
          const sources = await savedSources(context, id);
          receipt.intakeObservation = {
            sourceCount: sources.length,
            completedCount: sources.filter(candidate => candidate.processingStatus === 'completed').length,
            degradedCount: sources.filter(candidate => candidate.processingStatus === 'degraded').length,
            readableCount: sources.filter(candidate => !!candidate.content?.trim()).length,
          };
          if (sources.length !== 1) return false;
          source = sources[0];
          return retainedFact.test(source.content || '') && ['completed', 'degraded'].includes(source.processingStatus);
        }, { timeout: 120_000, message: `Saved single ${format} source must retain its known factual content` }).toBe(true);
      } finally {
        // Intake failures still retain bounded HTTP/status evidence, without source text.
        if (publicSource) receipt.extractionResponses = extractionResponses;
        persist();
      }
      if (publicSource) {
        const acceptedPaths = format === 'website' ? ['/api/proxy/extract-web'] : ['/api/youtube/youtube-transcript', '/api/youtube-edge'];
        receipt.extractionResponses = extractionResponses;
        expect(extractionResponses.some(r => acceptedPaths.includes(r.path) && r.status >= 200 && r.status < 300), 'Actual extraction endpoint must succeed').toBe(true);
        expect(source.content.length, 'Public source must contain readable extracted text, not a URL/title placeholder').toBeGreaterThan(1000);
        expect(source.content).toMatch(/photosynthesi/i);
        if (format === 'youtube') expect(source.content).toMatch(/chloroplast/i);
      }
      receipt.source = { id: source.id, type: source.type, status: source.processingStatus, retainedFact: retainedFact.source, contentLength: source.content.length, metadata: source.metadata, ...(publicSource ? { extractedExcerpt: source.content.slice(0, 600) } : { syntheticContent: source.content }) };
      await page.reload(); await tab(page, 'Sources');
      await expect(sourceTitle(page, source.title)).toBeVisible();
      await sourceTitle(page, source.title).click();
      await expect(page.locator('.prose').filter({ hasText: retainedFact }).first()).toBeVisible();
      receipt.stages.intake = { status: 'passed', reloadViewerFact: true }; persist();

      await stage('logout-login-persistence', async () => {
        await page.goto('/');
        await page.locator('header button[aria-haspopup="menu"]').first().click();
        const signedOut = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signout' && r.request().method() === 'POST');
        await page.getByRole('menuitem', { name: /(?:^|\s)Sign out$/ }).click();
        expect((await signedOut).status()).toBe(200);
        await page.waitForURL(/\/auth/);
        expect((await context.request.get('/api/user/profile')).status()).toBe(401);
        await authenticate(page, email, false);
        const persisted = await savedSources(context, id);
        expect(persisted).toHaveLength(1);
        expect(persisted[0].id).toBe(source.id); expect(persisted[0].content).toMatch(retainedFact);
        await page.goto(`/notebook/${id}`); await tab(page, 'Sources');
        await expect(sourceTitle(page, source.title)).toBeVisible();
        await sourceTitle(page, source.title).click();
        await expect(page.locator('.prose').filter({ hasText: retainedFact }).first()).toBeVisible();
      });

      // Source background generation shares the real 45-second provider budget.
      // Coordinator must keep this matrix single-worker and avoid other inference runs.
      await page.reload();
      await page.waitForTimeout(46_000);
      await stage('grounded-chat', async () => {
        await tab(page, 'Chat');
        const input = page.getByPlaceholder(/Start typing|Ask only/);
        await expect(input).toBeEnabled();
        let initialMessages: SavedMessage[] = [];
        if (format === 'youtube') {
          const before = await context.request.get(`/api/notebooks/${id}/messages`);
          expect(before.status()).toBe(200);
          const data = await before.json(); initialMessages = data.messages || data;
          assertFreshConversation(initialMessages);
        }
        await input.fill(question);
        const chatResponse = page.waitForResponse(response =>
          new URL(response.url()).pathname === `/api/notebooks/${id}/chat`
          && response.request().method() === 'POST', { timeout: 65_000 });
        await input.press('Enter');
        const completedChat = await chatResponse;
        const chatBody = await completedChat.json();
        receipt.chatResponse = { status: completedChat.status(), code: chatBody.code || null };
        persist();
        expect(completedChat.status(), `Grounded chat failed: ${chatBody.code || 'unknown error'}`).toBe(200);
        await expect.poll(async () => {
          const response = await context.request.get(`/api/notebooks/${id}/messages`);
          expect(response.status()).toBe(200);
          const data = await response.json();
          return format === 'youtube'
            ? ((data.messages || data) as SavedMessage[]).filter(m => m.role === 'assistant').length > 0
            : ((data.messages || data) as SavedMessage[]).some(m => m.role === 'assistant' && answerFact.test(m.content));
        }, { timeout: 65_000 }).toBe(true);
        const messagesResponse = await context.request.get(`/api/notebooks/${id}/messages`);
        expect(messagesResponse.status()).toBe(200);
        const messagesData = await messagesResponse.json();
        const answer = format === 'youtube'
          ? selectNewAssistant(initialMessages, messagesData.messages || messagesData, question) as SavedMessage
          : ((messagesData.messages || messagesData) as SavedMessage[])
            .find(message => message.role === 'assistant' && answerFact.test(message.content));
        if (format === 'youtube') {
          const independent = checkYouTube({ question, source, answer, citations: messageCitations(answer!),
            project: testInfo.project.name, publicRoot: artifactRoot });
          receipt.youtubeIndependentAcceptance = independent; persist();
          expect(independent.accept, `Independent YouTube acceptance: ${independent.reasons.join(',')}`).toBe(true);
        }
        expect(answer).toBeTruthy();
        const savedCitation = messageCitations(answer!).find(item => Number(item.citation_id) === 1);
        expect(savedCitation, 'Citation 1 must persist structured evidence').toBeTruthy();
        expect(savedCitation!.source_id).toBe(source.id);
        const excerpt = (savedCitation!.prefetched_content || savedCitation!.excerpt || '').trim();
        expect(excerpt.length).toBeGreaterThan(0);
        expect(normalizeEvidence(source.content).includes(normalizeEvidence(excerpt)), 'Displayed evidence must be verbatim from the owned source').toBe(true);
        // Keep the queried-fact requirement: a correct answer does not make an
        // unrelated bibliography or carbohydrate introduction support it.
        receipt.chatCitation = { sourceId: savedCitation!.source_id, citationId: 1, ...(format === 'youtube' ? { excerptSHA256: sha256(excerpt), excerptLength: excerpt.length } : { excerpt }), queriedFactSupported: retainedFact.test(excerpt) };
        expect(retainedFact.test(excerpt), 'The citation excerpt must support the specific queried fact').toBe(true);
        const citation = page.getByRole('button', { name: /^Citation 1/ }).first();
        await expect(citation).toBeVisible(); await citation.focus(); await citation.press('Enter');
        await expect(citation).toHaveAttribute('aria-expanded', 'true');
        const evidenceId = await citation.getAttribute('aria-controls');
        expect(evidenceId).toBeTruthy();
        if (format === 'youtube') await expect.poll(async () => { const text = await page.locator(`[id="${evidenceId}"]`).innerText(); return retainedFact.test(text); }).toBe(true);
        else await expect(page.locator(`[id="${evidenceId}"]`)).toContainText(retainedFact);
        if (format === 'youtube') await expect.poll(async () => { const text = await page.locator(`[id="${evidenceId}"]`).innerText(); return text.includes(excerpt); }).toBe(true);
        else await expect(page.locator(`[id="${evidenceId}"]`)).toContainText(excerpt);
        await page.reload(); await tab(page, 'Chat');
        const restoredCitation = page.getByRole('button', { name: /^Citation 1/ }).first();
        await expect(restoredCitation).toBeVisible();
        await restoredCitation.click();
        await expect(restoredCitation).toHaveAttribute('aria-expanded', 'true');
        const restoredId = await restoredCitation.getAttribute('aria-controls');
        expect(restoredId).toBeTruthy();
        if (format === 'youtube') await expect.poll(async () => { const text = await page.locator(`[id="${restoredId}"]`).innerText(); return text.includes(excerpt); }).toBe(true);
        else await expect(page.locator(`[id="${restoredId}"]`)).toContainText(excerpt);
        if (format === 'youtube') await expect.poll(async () => { const text = await page.locator(`[id="${restoredId}"]`).innerText(); return retainedFact.test(text); }).toBe(true);
        else await expect(page.locator(`[id="${restoredId}"]`)).toContainText(retainedFact);
      });
      await stage('open-studio', async () => {
        await page.reload(); await tab(page, 'Studio');
        await expect(page.getByRole('button', { name: /^Flashcards/ }).first()).toBeVisible();
      });
      await stage('studio-flashcards', async () => {
        const trigger = page.getByRole('button', { name: /^Flashcards/ }).first();
        if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
        const deckName = `${publicSource ? 'Photosynthesis' : 'Cedar'} ${format} QA`;
        await page.getByRole('button', { name: /(?:^|\s)New Deck$/ }).click();
        await page.getByPlaceholder('Deck name...').fill(deckName);
        // The UI mutation saves asynchronously; observe the real creation response
        // before reading persisted state, rather than racing the server request.
        const deckCreated = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/notebooks/${id}/studio/decks`);
        await page.getByRole('button', { name: /(?:^|\s)Create Deck$/ }).click();
        const creationResponse = await deckCreated;
        expect(creationResponse.status(), 'Deck creation must finish successfully on the server').toBe(201);
        await expect(page.getByText(deckName, { exact: true })).toBeVisible();
        receipt.deckCreation = { status: creationResponse.status(), rendered: true };
        persist();
        const readDeck = async (owner = context) => {
          const response = await owner.request.get(`/api/notebooks/${id}/studio/decks`);
          expect(response.status()).toBe(200);
          const deck = ((await response.json()).decks as SavedDeck[]).find(candidate => candidate.name === deckName);
          expect(deck, 'Generated deck must exist on the real server').toBeTruthy();
          return deck!;
        };
        // Retain ownership coverage for this deck even if generation returns no cards.
        savedDeckId = (await readDeck()).id;
        await page.getByRole('button', { name: /(?:^|\s)Generate$/ }).click();
        const dialog = page.getByRole('dialog'); const combos = dialog.getByRole('combobox');
        await combos.nth(0).click(); await page.getByRole('option', { name: deckName, exact: true }).click();
        await combos.nth(1).click(); await page.getByRole('option', { name: source.title, exact: true }).click();
        await combos.nth(2).click(); await page.getByRole('option', { name: '3 cards', exact: true }).click();
        const responseObservations: Record<string, unknown>[] = [];
        const pendingObservations: Promise<void>[] = [];
        const observeResponse = (response: Response) => {
          const path = new URL(response.url()).pathname;
          const method = response.request().method();
          const kind = method === 'POST' && ['/api/ai/generate', '/api/generate'].includes(path)
            ? 'generate'
            : method === 'PUT' && path === `/api/notebooks/${id}/studio/decks/${savedDeckId}` ? 'deck-save' : undefined;
          if (kind) pendingObservations.push(safeGenerationResponse(response, kind).then(value => { responseObservations.push(value); }));
        };
        const diagnosticObservations: SafeAcceptanceDiagnostic[] = [];
        let invalidDiagnosticCount = 0, droppedDiagnosticCount = 0;
        const diagnosticsEnabled = process.env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1';
        const ratioObservations: SafeRatioDiagnostic[] = [];
        let invalidRatioCount = 0, droppedRatioCount = 0;
        const observeDiagnostic = (message: ConsoleMessage) => {
          if (message.type() !== 'info') return;
          if (ratioDiagnosticsEnabled() && message.text().startsWith(ratioDiagnosticPrefix)) {
            const value = parseRatioDiagnostic(message.type(), message.text());
            if (!value) invalidRatioCount = Math.min(10000, invalidRatioCount + 1);
            else if (ratioObservations.length >= 50) droppedRatioCount = Math.min(10000, droppedRatioCount + 1);
            else ratioObservations.push(value);
            return;
          }
          if (message.type() !== 'info' || !message.text().startsWith(acceptanceDiagnosticPrefix)) return;
          const value = parseAcceptanceDiagnostic(message.type(), message.text());
          if (!value) { invalidDiagnosticCount = Math.min(10000, invalidDiagnosticCount + 1); return; }
          if (diagnosticObservations.length >= 50) { droppedDiagnosticCount = Math.min(10000, droppedDiagnosticCount + 1); return; }
          diagnosticObservations.push(value);
        };
        if (diagnosticsEnabled) page.on('console', observeDiagnostic);
        page.on('response', observeResponse);
        let generationWaitError: unknown;
        let visibleGenerationError: ReturnType<typeof safeGenerationError> | null = null;
        try {
          await dialog.getByRole('button', { name: /(?:^|\s)Generate Cards$/ }).click();
          // Poll rendered completion/error, not an exact card count; generate is clicked exactly once.
          await expect.poll(async () => {
            if (!await dialog.isVisible()) return 'complete';
            // Current UI has an unlabelled error paragraph; accept a future semantic alert as well.
            const alert = dialog.locator('[role="alert"], p.text-red-600').first();
            if (await alert.isVisible()) {
              visibleGenerationError = safeGenerationError((await alert.textContent()) ?? '');
              return 'error';
            }
            return 'pending';
          }, { timeout: 65_000, message: 'Generation must finish or render a user-visible error' }).not.toBe('pending');
        } catch (error) { generationWaitError = error; }
        finally {
          page.off('response', observeResponse);
          if (diagnosticsEnabled) page.off('console', observeDiagnostic);
          await Promise.all(pendingObservations);
          receipt.flashcardGeneration = {
            responses: responseObservations,
            ...(ratioDiagnosticsEnabled() ? { ratioDiagnostics: { evidenceClass: 'acceptance-diagnostics', observations: ratioObservations, invalidCount: invalidRatioCount, droppedCount: droppedRatioCount } } : {}),
            ...(diagnosticsEnabled ? { acceptanceDiagnostics: { evidenceClass: 'acceptance-diagnostics', observations: diagnosticObservations, invalidCount: invalidDiagnosticCount, droppedCount: droppedDiagnosticCount, missing: diagnosticObservations.length === 0 } } : {}),
            visibleError: visibleGenerationError,
            completion: generationWaitError ? 'wait-failed' : visibleGenerationError ? 'error' : 'complete',
          };
          persist();
        }
        const deck = await readDeck();
        // Independently audit every saved card before any generation/count assertion.
        receipt.generatedCards = deck.cards.map(c => ({ front: c.front, back: c.back, sourceId: c.sourceId }));
        const profile = format === 'website' ? 'wikipedia-photosynthesis' : format === 'youtube' ? 'ted-photosynthesis' : 'cedar';
        const cardAudits = deck.cards.map(card => auditProseCard({ card, source, profile, authorizedSourceIds: [source.id] }));
        receipt.generatedCardAudits = cardAudits;
        receipt.persistedFlashcardSummary = {
          requestedCount: 3, savedCount: deck.cards.length,
          supportedCount: cardAudits.filter(audit => audit.outcome === 'independently-supported').length,
          deckSaveResponseCount: responseObservations.filter(value => value.kind === 'deck-save').length,
        };
        persist();
        if (generationWaitError) throw generationWaitError;
        expect(visibleGenerationError, 'Generation must not render a failure; inspect safe receipt diagnostics').toBeNull();
        expect(deck.cards).toHaveLength(3);
        for (const [index, card] of deck.cards.entries()) {
          expect(card.sourceId).toBe(source.id);
          expect(card.front.trim().length).toBeGreaterThan(0); expect(card.back.trim().length).toBeGreaterThan(0);
          expect(cardAudits[index].outcome, `Card ${index + 1} independent prose audit: ${JSON.stringify(cardAudits[index])}`).toBe('independently-supported');
        }
        await expect(page.getByRole('button', { name: /(?:^|\s)Review 3 Cards$/ })).toBeVisible({ timeout: 65_000 });
        await page.getByRole('button', { name: /(?:^|\s)Review 3 Cards$/ }).click();
        for (let index = 1; index <= 3; index++) {
          await expect(page.getByText(`Card ${index} of 3`, { exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
          await page.getByRole('button', { name: /(?:^|\s)Easy$/ }).click();
        }
        await expect(page.getByText('Session Complete!', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: /(?:^|\s)Done$/ }).click();
        await page.reload(); await tab(page, 'Studio');
        const reopen = page.getByRole('button', { name: /^Flashcards/ }).first();
        if (await reopen.getAttribute('aria-expanded') !== 'true') await reopen.click();
        await expect(page.getByText(deckName, { exact: true })).toBeVisible();
        const persisted = await readDeck();
        expect(persisted.cards.map(c => ({ front: c.front, back: c.back, sourceId: c.sourceId }))).toEqual(receipt.generatedCards);
        expect(persisted.cards.every(c => c.correctCount === 1)).toBe(true);
        const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block', viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
        try {
          const freshPage = await fresh.newPage();
          await authenticate(freshPage, email, false);
          const freshSources = await savedSources(fresh, id);
          expect(freshSources[0].id).toBe(source.id);
          expect(freshSources[0].content).toMatch(retainedFact);
          const freshDeck = await readDeck(fresh);
          expect(freshDeck.cards.map(c => ({ front: c.front, back: c.back, sourceId: c.sourceId }))).toEqual(receipt.generatedCards);
          expect(freshDeck.cards.every(c => c.correctCount === 1)).toBe(true);
          await freshPage.goto(`/notebook/${id}`); await tab(freshPage, 'Studio');
          const freshTrigger = freshPage.getByRole('button', { name: /^Flashcards/ }).first();
          if (await freshTrigger.getAttribute('aria-expanded') !== 'true') await freshTrigger.click();
          await expect(freshPage.getByText(deckName, { exact: true })).toBeVisible();
          receipt.freshBrowserServerPersistence = true;
        } finally { await fresh.close(); }
      });
      await stage('ownership', async () => {
        const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block' });
        try {
          const otherPage = await other.newPage(); await authenticate(otherPage, `other-${randomUUID()}@studypod.invalid`, true);
          for (const path of [`/api/notebooks/${id}`, `/api/notebooks/${id}/sources`, `/api/notebooks/${id}/studio/decks`, ...(savedDeckId ? [`/api/notebooks/${id}/studio/decks/${savedDeckId}`] : [])]) {
            const response = await other.request.get(path); expect([403, 404]).toContain(response.status());
            expect(await response.text()).not.toMatch(retainedFact);
          }
          const ownerSources = await savedSources(context, id); expect(ownerSources).toHaveLength(1);
          expect(ownerSources[0].id).toBe(source.id); expect(ownerSources[0].content).toMatch(retainedFact);
        } finally { await other.close(); }
      });
      expect(receipt.pageErrors).toEqual([]);
      expect(downstreamFailures, 'Inspect individual stage receipts; intake success is separate from generation failures').toEqual([]);
      receipt.phase = 'passed';
    } catch (error) {
      if (preUploadBoundary && receipt.phase === 'intake') await attachPreUploadDiagnostics().catch(() => undefined);
      if (!receipt.stages.intake && receipt.phase === 'intake') receipt.stages.intake = { status: 'failed' };
      receipt.phase = 'failed'; receipt.failure = error instanceof Error ? error.message.slice(0, 1800) : String(error); throw error;
    } finally {
      persist(); await testInfo.attach('source-downstream-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, publicReceipt()), null, 2)), contentType: 'application/json' });
    }
  });
}
