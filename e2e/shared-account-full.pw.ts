import { sanitizeSharedErrors, sharedFailureCategory } from './shared-account-diagnostics.mjs';
import type { SharedAcceptanceReceipt, SharedMessage, SharedSource } from './shared-account-types';
import { test, expect, type Page, type BrowserContext, type Response, type Request } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { content } from './full-flow-fixtures.mjs';
import { createSharedFullPolicy } from './shared-account-full-policy.mjs';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { openSharedAccountLogin } from './shared-account-auth';
import { observeAudioAsrProvenance } from './audio-asr-provenance.mjs';
import { diagnoseAudioPcm } from './audio-pcm-diagnostic.mjs';

// Playwright requires object destructuring even when no fixtures are requested.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => { sanitizeSharedErrors(testInfo.errors); });

const formats = ['txt', 'md', 'markdown', 'pdf', 'docx', 'epub', 'wav', 'mp3', 'm4a', 'bookmarks', 'bookmarks-js', 'paste', 'website', 'youtube'];
const trayFact = /(?:17|seventeen) blue trays/i;
async function read<T = unknown>(page: Page, path: string) {
  return page.evaluate(async path => { const r = await fetch(path); return { status: r.status, body: r.ok ? await r.json() as T : null }; }, path);
}

// Read the persisted citation protocol rather than assuming source order equals citation ID.
function ownedCitationIds(message: SharedMessage, sourceId: string): number[] {
  const row = message as SharedMessage & { groundedSources?: unknown; grounded_sources?: unknown };
  let metadata = row.groundedSources ?? row.grounded_sources;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata) as unknown; } catch { return []; }
  }
  if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || metadata.version !== 1 || !('citations' in metadata) || !Array.isArray(metadata.citations)) return [];
  return metadata.citations.flatMap((citation: unknown) => {
    if (!citation || typeof citation !== 'object' || !('citation_id' in citation) || !('source_id' in citation)) return [];
    const citationId = citation.citation_id;
    return typeof citationId === 'number' && Number.isInteger(citationId) && citationId > 0 && citation.source_id === sourceId && message.content.includes('[' + citationId + ']') ? [citationId] : [];
  });
}

for (const format of formats) test(`shared source ${format}: upload viewer persistence and grounded chat`, async ({ browser }, testInfo) => {
  const origin = validateSharedAccountEnvironment(process.env);
  const policy = createSharedFullPolicy(origin);
  const marker = `Synthetic QA ${format} ${randomUUID()}`;
  const contexts: BrowserContext[] = [];
  const closingContexts = new Set<BrowserContext>();
  const receipt: SharedAcceptanceReceipt = { phase: 'login', format, origin, credentialsPersisted: false, legacy106Eligible: false, deniedRequests: [], cleanup: 'not-created', checks: {} };
  let cleanupPage: Page | undefined;
  let asrObserver: ReturnType<typeof observeAudioAsrProvenance> | undefined;
  let id = '';
  const fresh = async () => {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', async route => {
      const request = route.request();
      try {
      const isFileExtraction = ['/api/pdf/process-pdf', '/api/audiobook/extract'].includes(new URL(request.url()).pathname);
      const decision = policy.decide(request.url(), request.method(), isFileExtraction ? { contentType: request.headers()['content-type'], body: request.postDataBuffer() } : undefined);
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
      } catch {
        if (!closingContexts.has(context)) {
          receipt.checks.activeRouteErrors = Number(receipt.checks.activeRouteErrors || 0) + 1;
          receipt.checks.lastRouteError = { method: request.method(), path: new URL(request.url()).pathname, phase: receipt.phase };
        }
        await route.abort('failed').catch(() => {});
      }
    });
    const page = await openSharedAccountLogin(context, origin);
    if (!asrObserver && process.env.STUDYPOD_ASR_PROVENANCE === '1' && ['wav', 'mp3', 'm4a'].includes(format)) {
      asrObserver = observeAudioAsrProvenance(page, { enabled: true, origin, configuredModel: process.env.VITE_AUDIO_TRANSCRIPTION_MODEL });
      receipt.checks.asrProvenance = asrObserver.receipt;
    }
    await page.getByLabel('Email Address').fill(process.env.STUDYPOD_SHARED_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_SHARED_PASSWORD!);
    const signin = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signin' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signin).status()).toBe(200);
    await page.waitForURL(url => url.pathname === '/');
    const profile = await read<{ user?: { email?: string } }>(page, '/api/user/profile');
    expect(profile.status).toBe(200);
    expect(profile.body?.user?.email === process.env.STUDYPOD_SHARED_EMAIL, 'Runtime approved existing identity').toBe(true);
    policy.verifyIdentity();
    return page;
  };
  try {
    const page = await fresh(); cleanupPage = page;
    receipt.phase = 'new-notebook-create';
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/notebooks' && r.request().method() === 'POST');
    await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).click();
    const notebookCreateStatus = (await created).status();
    receipt.checks.notebookCreateStatus = notebookCreateStatus;
    expect(notebookCreateStatus).toBe(201);
    receipt.phase = 'new-notebook-navigation';
    await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    id = new URL(page.url()).pathname.split('/').pop()!;
    receipt.phase = 'new-notebook-ownership';
    expect(policy.ids()).toEqual([id]); receipt.notebookId = id;
    receipt.phase = 'new-notebook-rename';
    const renameStatus = await page.evaluate(async ({ id, title }) => (await fetch(`/api/notebooks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })).status, { id, title: marker });
    receipt.checks.notebookRenameStatus = renameStatus;
    expect(renameStatus).toBe(200);
    receipt.phase = 'source-intake';
    await page.getByRole('button', { name: /^(?:Add|Add a source)$/ }).first().click();
    if (format === 'paste') {
      await page.getByRole('button', { name: /Pasted Content/ }).click();
      await page.getByLabel('Title', { exact: true }).fill(`${marker} source`);
      await page.getByLabel('Content', { exact: true }).fill(content);
      await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
    } else if (format === 'website') {
      await page.getByRole('button', { name: /Website URLs/ }).click();
      await page.getByPlaceholder(/Enter URLs one per line/).fill('https://en.wikipedia.org/wiki/Photosynthesis');
      await page.getByRole('button', { name: 'Add 1 Website', exact: true }).click();
    } else if (format === 'youtube') {
      await page.getByRole('button', { name: /YouTube Ingestion/ }).click();
      await page.getByLabel(/YouTube video URL/).fill('https://www.youtube.com/watch?v=eo5XndJaz-Y');
      await page.getByLabel(/Preferred transcript language/).fill('en');
      await page.getByRole('dialog').getByRole('button', { name: 'Add Source', exact: true }).click();
    } else if (format.startsWith('bookmarks')) {
      await page.getByRole('button', { name: /Bookmarks & Tweets/ }).click();
      await page.getByRole('tab', { name: /Twitter Archive JS\/JSON/ }).click();
      const entries = JSON.stringify([{ tweetId: '1234567890123456789', user: { screen_name: 'cedarqa', name: 'Cedar QA' }, text: content }]);
      const js = format === 'bookmarks-js';
      const chooser = page.waitForEvent('filechooser');
      await page.getByText('Drag and drop your bookmarks export here', { exact: true }).click();
      await (await chooser).setFiles({ name: js ? 'cedar-bookmarks.js' : 'cedar-bookmarks.json', mimeType: js ? 'application/javascript' : 'application/json', buffer: Buffer.from(js ? `window.YTD.bookmark.part0 = ${entries};` : entries) });
      await expect(page.getByText('1 bookmark found', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Import Archive', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Import Bookmarks & Tweet Seeds', exact: true })).toBeHidden();
      const intakeDialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
      if (await intakeDialog.isVisible()) await intakeDialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(intakeDialog).toBeHidden();
    } else {
      receipt.phase = 'fixture-check';
      const fixtureDir = process.env.STUDYPOD_SHARED_FIXTURE_DIR;
      expect(!!fixtureDir, 'Existing fixture directory is required').toBe(true);
      const file = resolve(fixtureDir!, `cedar.${format}`);
      expect(existsSync(file), 'Approved synthetic fixture exists').toBe(true);
      const extractionUpload = ['pdf', 'epub'].includes(format) ? {
        name: `cedar.${format}`,
        mimeType: format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
        buffer: readFileSync(file),
      } : undefined;
      if (format === 'pdf') policy.registerPdfFixture('cedar.pdf', extractionUpload!.buffer);
      if (format === 'epub') policy.registerEpubFixture('cedar.epub', extractionUpload!.buffer);
      if (['wav', 'mp3', 'm4a'].includes(format)) policy.registerAudioAssets();
      if (format === 'wav' && process.env.STUDYPOD_PCM_DIAGNOSTIC === '1') {
        receipt.phase = 'fixture-pcm-diagnostic';
        receipt.checks.audioPcm = await diagnoseAudioPcm(page, file, { enabled: true, sampleRate: 16000 });
      }
      receipt.phase = 'file-chooser';
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Browse files', exact: true }).click();
      receipt.phase = 'file-upload';
      if (['wav', 'mp3', 'm4a'].includes(format)) {
        const fixtureBytes = readFileSync(file);
        receipt.checks.audioFixture = {
          byteLength: fixtureBytes.length,
          uploadedFixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
        };
      }
      // Chromium omits filesystem-backed multipart bytes from CDP. An in-memory
      // FilePayload preserves the exact fixture so the request guard can verify it.
      await (await chooser).setFiles(extractionUpload || file);
    }
    receipt.phase = 'source-extraction';
    let source!: SharedSource;
    const sourceFact = format === 'youtube' ? /glucose/i : format === 'website' ? /carbon dioxide/i : trayFact;
    let extractionState = 'pending';
    await expect.poll(async () => {
      const response = await read<SharedSource[] | { sources?: SharedSource[] }>(page, `/api/notebooks/${id}/sources`);
      const sources = Array.isArray(response.body) ? response.body : response.body?.sources || [];
      const readyCount = sources.filter(s => ['completed', 'degraded'].includes(s.processingStatus)).length;
      const errorCount = sources.filter(s => s.processingStatus === 'failed').length;
      receipt.checks.lastExtraction = { status: response.status, sourceCount: sources.length, readyCount, errorCount };
      source = sources.find((s) => ['completed', 'degraded'].includes(s.processingStatus) && sourceFact.test(s.content || ''))!;
      extractionState = source ? 'ready' : sources.length > 0 && readyCount + errorCount === sources.length ? 'terminal-failure' : 'pending';
      if (['wav', 'mp3', 'm4a'].includes(format) && extractionState !== 'pending') {
        receipt.checks.terminalAudioExtraction = sources.map((item) => {
          const extractedContent = item.content || '';
          const normalized = extractedContent.normalize('NFKC').toLowerCase();
          return {
            contentLength: extractedContent.length,
            factMatch: sourceFact.test(extractedContent),
            syntheticTerms: {
              seventeen: /\b(?:17|seventeen)\b/.test(normalized),
              blue: /\bblue\b/.test(normalized),
              tray: /\btrays?\b/.test(normalized),
            },
          };
        });
      }
      return extractionState;
    }, { timeout: 180_000, message: 'Source extraction reaches a terminal state' }).not.toBe('pending');
    if (extractionState !== 'ready') receipt.phase = 'source-extraction-failed';
    expect(extractionState, 'Real extraction preserves required fact').toBe('ready');
    if (format === 'youtube') expect(/chloroplast/i.test(source.content)).toBe(true);
    receipt.checks.extracted = true;
    receipt.sourceId = source.id;
    receipt.processingStatus = source.processingStatus;
    // A source card normalizes file titles, so raw filename text is not its UI label.
    // This notebook has exactly one source; open its accessible card and verify
    // the actual reader identity and extracted fact before and after reload.
    const openSource = page.getByRole('button', { name: /^Open source / });
    const viewer = page.getByTestId('source-content-viewer');
    const verifyViewer = async () => {
      await expect(openSource).toHaveCount(1);
      await openSource.click();
      await expect(viewer).toBeVisible();
      await expect(viewer).toHaveAttribute('aria-label', `${source.title} source content`);
      await expect(viewer.locator('.prose')).toContainText(sourceFact);
    };
    receipt.phase = 'viewer-open';
    await verifyViewer();
    receipt.phase = 'viewer-reload';
    await page.reload();
    await verifyViewer();
    receipt.checks.viewerReload = true;
    receipt.phase = 'viewer-return';
    await page.getByRole('button', { name: 'Back to source list', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await expect(openSource).toHaveCount(1);
    receipt.phase = 'grounded-chat';
    const before = await read<SharedMessage[] | { messages?: SharedMessage[] }>(page, `/api/notebooks/${id}/messages`);
    const prior = Array.isArray(before.body) ? before.body : before.body?.messages || [];
    expect(prior.filter((m) => m.role === 'assistant').length).toBe(0);
    const question = format === 'youtube' ? 'Explain what glucose and chloroplasts do in photosynthesis. Cite this video transcript.' : format === 'website' ? 'What role does carbon dioxide have in photosynthesis? Cite the supplied source.' : 'How many blue trays are used in the Cedar experiment? Cite the source.';
    const chatStarted = Date.now();
    const safeGroundingReasons = new Set([
      'retry_invalid_json', 'retry_invalid_envelope', 'retry_insufficient',
      'retry_invalid_selection', 'retry_unknown_sentence', 'retry_source_ownership',
      'retry_nonliteral_sentence', 'retry_duplicate_sentence', 'retry_noncontiguous_evidence',
      'retry_evidence_over_budget', 'citation_missing', 'citation_claim_alignment', 'unclassified',
    ]);
    const chatProgress = { responseStatus: null as number | null, responseElapsedMs: null as number | null, groundingReason: null as string | null, requestFailed: false, assistantExists: false, contentLength: 0, requiredFactMatch: false, citationMarkerCount: 0, terminalUiError: false, lastPollElapsedMs: 0 };
    receipt.checks.chatProgress = chatProgress;
    const isChatRequest = (request: Request) => {
      const url = new URL(request.url());
      return request.method() === 'POST' && url.origin === origin && url.pathname === `/api/notebooks/${id}/chat` && !url.search;
    };
    let chatResponseDetails = Promise.resolve();
    const onChatResponse = async (response: Response) => {
      if (!isChatRequest(response.request())) return;
      chatProgress.responseStatus = response.status();
      chatProgress.responseElapsedMs = Date.now() - chatStarted;
      if (response.status() !== 422 || response.headers()['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return;
      const details = (async () => {
        try {
          const body: unknown = await response.json();
          const reason = body && typeof body === 'object' && 'groundingReason' in body ? body.groundingReason : undefined;
          if (typeof reason === 'string' && safeGroundingReasons.has(reason)) chatProgress.groundingReason = reason;
        } catch { /* Failed or non-JSON bodies have no safe diagnostic. */ }
      })();
      chatResponseDetails = Promise.all([chatResponseDetails, details]).then(() => {});
      await details;
    };
    const onChatFailure = (request: Request) => { if (isChatRequest(request)) chatProgress.requestFailed = true; };
    page.on('response', onChatResponse);
    page.on('requestfailed', onChatFailure);
    let answer!: SharedMessage;
    try {
      await page.getByPlaceholder(/Start typing|Ask only/).fill(question);
      await page.getByPlaceholder(/Start typing|Ask only/).press('Enter');
      const chatCompletion = { state: 'pending' as 'pending' | 'ready' | 'terminal' };
      await expect.poll(async () => {
        chatProgress.terminalUiError ||= await page.getByRole('status').getByText(/^(?:AI Temporarily Unavailable|You're Offline|Attachment Not Supported|Error)$/, { exact: true }).count() > 0;
        chatProgress.lastPollElapsedMs = Date.now() - chatStarted;
        const unsuccessfulResponse = chatProgress.responseStatus !== null && (chatProgress.responseStatus < 200 || chatProgress.responseStatus >= 300);
        if (unsuccessfulResponse || chatProgress.terminalUiError) {
          await chatResponseDetails;
          receipt.checks.chatTerminalFailure = { phase: receipt.phase, status: chatProgress.responseStatus, reason: unsuccessfulResponse ? 'non-2xx-response' : 'terminal-ui-error', elapsedMs: chatProgress.lastPollElapsedMs };
          chatCompletion.state = 'terminal';
          return chatCompletion.state;
        }
        const result = await read<SharedMessage[] | { messages?: SharedMessage[] }>(page, `/api/notebooks/${id}/messages`);
        const messages = Array.isArray(result.body) ? result.body : result.body?.messages || [];
        answer = messages.filter((m) => m.role === 'assistant').at(-1)!;
        const answerContent = answer?.content || '';
        chatProgress.assistantExists = Boolean(answer);
        chatProgress.contentLength = answerContent.length;
        chatProgress.requiredFactMatch = sourceFact.test(answerContent) && (format !== 'youtube' || /chloroplast/i.test(answerContent));
        chatProgress.citationMarkerCount = await page.getByRole('button', { name: /^Citation \d+/ }).count();
        chatCompletion.state = chatProgress.requiredFactMatch ? 'ready' : 'pending';
        return chatCompletion.state;
      }, { timeout: 180_000, message: 'Chat completes with a source fact or reports terminal failure' }).not.toBe('pending');
      if (chatCompletion.state === 'terminal') throw new Error(`Grounded chat terminal failure during ${receipt.phase}; HTTP ${chatProgress.responseStatus ?? 'unavailable'}`);
    } finally {
      page.off('response', onChatResponse);
      page.off('requestfailed', onChatFailure);
    }
    if (format === 'youtube') expect(/chloroplast/i.test(answer.content)).toBe(true);
    const citationId = ownedCitationIds(answer, source.id)[0];
    expect(citationId !== undefined, 'Answer persists a positive owned citation ID with a matching answer marker').toBe(true);
    const citationButton = page.getByRole('button', { name: 'Citation ' + citationId, exact: true }).first();
    await expect(citationButton).toBeVisible();
    chatProgress.citationMarkerCount = await page.getByRole('button', { name: /^Citation \d+$/ }).count();
    await citationButton.click();
    await expect(citationButton).toHaveAttribute('aria-expanded', 'true');
    receipt.checks.groundedChatCitation = true;
    receipt.phase = 'fresh-login-persistence';
    const second = await fresh(); cleanupPage = second;
    await second.goto(`/notebook/${id}`);
    const persisted = await read<SharedSource[] | { sources?: SharedSource[] }>(second, `/api/notebooks/${id}/sources`);
    const saved = Array.isArray(persisted.body) ? persisted.body : persisted.body?.sources || [];
    expect(saved.some((s) => s.id === source.id && sourceFact.test(s.content || ''))).toBe(true);
    const freshMessages = await read<SharedMessage[] | { messages?: SharedMessage[] }>(second, '/api/notebooks/' + id + '/messages');
    const reloadedMessages = Array.isArray(freshMessages.body) ? freshMessages.body : freshMessages.body?.messages || [];
    const persistedAnswer = reloadedMessages.find((message) => message.role === 'assistant' && message.content === answer.content);
    expect(Boolean(persistedAnswer) && ownedCitationIds(persistedAnswer!, source.id).includes(citationId), 'Fresh login preserves the answer and its owned citation marker').toBe(true);
    const freshCitationButton = second.getByRole('button', { name: 'Citation ' + citationId, exact: true }).first();
    await expect(freshCitationButton).toBeVisible();
    await freshCitationButton.click();
    await expect(freshCitationButton).toHaveAttribute('aria-expanded', 'true');
    receipt.checks.freshLogin = true;
    receipt.phase = 'complete';
  } catch (caught: unknown) {
    receipt.failure = { name: 'Error', matcher: null, assertion: sharedFailureCategory(caught) };
    throw new Error(`Shared acceptance failed during ${receipt.phase}; ${receipt.failure.assertion}`);
  }
  finally {
    if (id && cleanupPage && !cleanupPage.isClosed()) {
      try {
        const status = await cleanupPage.evaluate(async id => (await fetch(`/api/notebooks/${id}`, { method: 'DELETE' })).status, id);
        receipt.cleanup = status >= 200 && status < 300 && (await read(cleanupPage, `/api/notebooks/${id}`)).status === 404 ? 'verified-deleted' : 'retained-QA-notebook';
      } catch { receipt.cleanup = 'retained-QA-notebook'; }
    }
    await asrObserver?.stop();
    await testInfo.attach('shared-account-receipt', { body: Buffer.from(JSON.stringify(receipt)), contentType: 'application/json' });
    for (const context of contexts) { closingContexts.add(context); await context.close().catch(() => {}); }
  }
  expect(Number(receipt.checks.activeRouteErrors || 0), 'No active route transport errors').toBe(0);
  expect(receipt.cleanup).toBe('verified-deleted');
  expect(receipt.deniedRequests.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !r.quarantined)).toEqual([]);
});
