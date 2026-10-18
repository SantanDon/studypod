import { sanitizeSharedErrors, sharedFailureCategory } from './shared-account-diagnostics.mjs';
import type { SharedAcceptanceReceipt, SharedSource } from './shared-account-types';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { openStudio, verifyPlayback, nativeState } from './shared-account-media-helpers.mjs';
import { createSharedAudiobookPolicy, verifyAudiobookCleanup } from './shared-account-audiobook-policy.mjs';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { openSharedAccountLogin } from './shared-account-auth';

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => { sanitizeSharedErrors(testInfo.errors); });

import { facts } from './audio-fidelity.facts.mjs';
import { compareFacts } from './audio-fidelity.helpers.mjs';
async function read<T = unknown>(page: Page, path: string) {
  return page.evaluate(async path => { const r = await fetch(path); return { status: r.status, body: r.ok ? await r.json() as T : null }; }, path);
}

test('shared audiobook: three chapter reader playback saved state download and real transcription', async ({ browser }, testInfo) => {
  const origin = validateSharedAccountEnvironment(process.env);
  const policy = createSharedAudiobookPolicy(origin);
  const format = 'audiobook';
  const marker = `Synthetic QA audiobook ${randomUUID()}`;
  const directory = resolve(testInfo.outputDir); mkdirSync(directory, { recursive: true });
  let ownerId = '';
  let savedFile = '';
  let bookSource: SharedSource | undefined;
  const contexts: BrowserContext[] = [];
  const closingContexts = new Set<BrowserContext>();
  const receipt: SharedAcceptanceReceipt = { phase: 'login', format, origin, credentialsPersisted: false, legacy106Eligible: false, deniedRequests: [], cleanup: 'not-created', checks: {} };
  let cleanupPage: Page | undefined;
  let id = '';
  const notebookListStatuses: number[] = [];
  let notebookListRequestFailures = 0;
  let pageErrors = 0;
  const fresh = async () => {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', async route => {
      const request = route.request();
      try {
      const body: unknown = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : undefined;
      const decision = policy.decide(request.url(), request.method(), body);
      if (!decision.allowed) {
        receipt.deniedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, reason: decision.reason, quarantined: decision.quarantined === true });
        await route.abort('blockedbyclient'); return;
      }
      if (decision.captureCreated || decision.captureExtract || decision.captureJob) {
        const response = await route.fetch({ maxRedirects: 0 });
        if (decision.captureCreated && response.status() === 201) {
          const createdId = (await response.json()).id;
          policy.registerCreated(createdId); id = createdId; receipt.notebookId = id; receipt.cleanup = 'pending';
        }
        if (decision.captureExtract && response.ok()) {
          const extractedFile = (await response.json()).fileName;
          policy.registerFile(extractedFile); savedFile = extractedFile;
        }
        if (decision.captureJob && response.ok()) policy.registerJob((await response.json()).jobId);
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
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/notebooks' && response.request().method() === 'GET' && notebookListStatuses.length < 20) notebookListStatuses.push(response.status());
    });
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === '/api/notebooks' && request.method() === 'GET') notebookListRequestFailures++;
    });
    page.on('pageerror', () => { pageErrors++; });
    await page.getByLabel('Email Address').fill(process.env.STUDYPOD_SHARED_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_SHARED_PASSWORD!);
    const signin = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signin' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signin).status()).toBe(200);
    await page.waitForURL(url => url.pathname === '/');
    const profile = await read<{ user?: { email?: string; id?: string } }>(page, '/api/user/profile');
    expect(profile.status).toBe(200);
    expect(profile.body?.user?.email === process.env.STUDYPOD_SHARED_EMAIL, 'Runtime approved existing identity').toBe(true);
    expect(profile.body?.user?.id).toBeTruthy(); ownerId = profile.body!.user!.id!;
    policy.verifyIdentity();
    return page;
  };
  try {
    const page = await fresh(); cleanupPage = page;
    receipt.phase = 'new-notebook';
    receipt.checks.newNotebookSubstep = 'click-create';
    const [created] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/notebooks' && r.request().method() === 'POST'),
      page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).click().then(() => { receipt.checks.newNotebookSubstep = 'await-create-response'; }),
    ]);
    receipt.checks.newNotebookCreateStatus = created.status();
    receipt.checks.newNotebookSubstep = 'assert-create-response';
    expect(created.status()).toBe(201);
    receipt.checks.newNotebookSubstep = 'navigate-owned-notebook';
    await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    receipt.checks.newNotebookSubstep = 'assert-owned-notebook';
    expect(new URL(page.url()).pathname.split('/').pop()).toBe(id);
    expect(policy.ids()).toEqual([id]); receipt.notebookId = id;
    receipt.checks.newNotebookSubstep = 'rename-owned-notebook';
    expect(await page.evaluate(async ({ id, title }) => (await fetch(`/api/notebooks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })).status, { id, title: marker })).toBe(200);
    receipt.checks.newNotebookSubstep = 'ready';

    receipt.phase = 'three-chapter-epub';
    const chapterTexts = [
      'The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings.',
      'The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis.',
      'Plants use carbon dioxide and water to produce sugars and release oxygen. The control receives the same water but no light. Researchers compare growth after fourteen days. No private or copyrighted course material is included.',
    ];
    const titles = ['Beginning', 'Middle', 'Ending'];
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">cedar-synthetic</dc:identifier><dc:title>' + marker + '</dc:title><dc:creator>StudyPod QA</dc:creator><dc:language>en</dc:language></metadata><manifest>' + titles.map((_, i) => '<item id="c' + i + '" href="c' + i + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>' + titles.map((_, i) => '<itemref idref="c' + i + '"/>').join('') + '</spine></package>');
    titles.forEach((title, i) => zip.file('OEBPS/c' + i + '.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + title + '</title></head><body><h1>' + title + '</h1><p>' + chapterTexts[i] + '</p></body></html>'));
    zip.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>' + titles.map((title, i) => '<li><a href="c' + i + '.xhtml">' + title + '</a></li>').join('') + '</ol></nav></body></html>');
    const epubPath = resolve(directory, 'cedar-three-chapters.epub');
    const epubBytes = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(epubPath, epubBytes);
    receipt.checks.fixture = { sha256: createHash('sha256').update(epubBytes).digest('hex'), chapterCount: 3, synthetic: true };
    receipt.checks.audiobookSubstep = 'open-studio';
    await openStudio(page, expect);
    receipt.checks.audiobookSubstep = 'open-audiobook-card';
    await page.getByTestId('audiobook-studio-card').click();
    const workspace = page.getByTestId('audiobook-workspace');
    receipt.checks.audiobookSubstep = 'await-upload-workspace';
    await expect(workspace).toBeVisible();
    const extracted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/audiobook/extract' && r.request().method() === 'POST');
    receipt.checks.audiobookSubstep = 'upload-three-chapter-epub';
    await workspace.getByTestId('audiobook-book-upload').first().setInputFiles(epubPath);
    receipt.checks.audiobookSubstep = 'extraction-status';
    const extractionStatus = (await extracted).status();
    receipt.checks.extraction = { status: extractionStatus, registeredBook: policy.files().length === 1 };
    expect(extractionStatus, 'Owned synthetic EPUB extraction HTTP status').toBe(200);
    expect(policy.files()).toHaveLength(1); savedFile = policy.files()[0];
    receipt.checks.audiobookSubstep = 'await-extracted-notebook-source';
    const getSources = async (p: Page) => {
      const result = await read<SharedSource[] | { sources: SharedSource[] }>(p, '/api/notebooks/' + id + '/sources');
      expect(result.status).toBe(200);
      return Array.isArray(result.body) ? result.body : result.body?.sources || [];
    };
    await expect.poll(async () => {
      const sources = await getSources(page);
      bookSource = sources.find(source => source.title === marker);
      return !!bookSource && chapterTexts.every(text => bookSource!.content.includes(text));
    }, { timeout: 90_000 }).toBe(true);
    receipt.sourceId = bookSource!.id;
    await page.reload();
    await page.getByRole('button', { name: 'Open source ' + bookSource!.title, exact: true }).click();
    const viewer = page.getByTestId('source-content-viewer');
    await expect(viewer).toBeVisible();
    for (const text of chapterTexts) await expect(viewer).toContainText(text);
    receipt.checks.reader = { beginning: true, middle: true, ending: true, actualUploadedSource: true };
    await page.reload(); await openStudio(page, expect);
    await page.getByTestId('audiobook-studio-card').click();
    receipt.phase = 'full-generation';
    const capability = await read<{ capabilities?: { enabled?: boolean; fullGeneration?: boolean } }>(page, '/api/audiobook/voices');
    receipt.checks.capabilities = { status: capability.status, enabled: capability.body?.capabilities?.enabled === true, fullGeneration: capability.body?.capabilities?.fullGeneration === true };
    expect(capability.status).toBe(200);
    expect(capability.body?.capabilities?.enabled === true && capability.body?.capabilities?.fullGeneration === true, 'Real full-book narration provider must be ready').toBe(true);
    await expect(page.getByTestId('audiobook-create-full')).toBeEnabled();
    await page.getByTestId('audiobook-create-full').click();
    await expect(page.getByTestId('audiobook-job-complete')).toBeVisible({ timeout: 360_000 });
    interface Manifest {
      fileName: string; renderId: string;
      chapters: { id: string; title: string; narratable?: boolean; audioUrl?: string; status?: string }[];
      listenerState: { currentChapterId: string; playbackRate: number; currentTimeSeconds: number };
      bookmarks: { id: string; chapterId: string; timeSeconds: number }[];
    }
    const manifestPath = '/api/audiobook/books/' + encodeURIComponent(savedFile) + '/playback-manifest';
    const manifest = (await read<Manifest>(page, manifestPath)).body!;
    expect(manifest.fileName).toBe(savedFile); expect(manifest.renderId).toBeTruthy();
    const ready = manifest.chapters.filter(chapter => chapter.narratable !== false && chapter.audioUrl);
    expect(ready).toHaveLength(3);
    for (const title of titles) expect(ready.some(chapter => chapter.title.includes(title))).toBe(true);
    const player = page.getByTestId('audiobook-chapter-player');
    await expect(player).toBeVisible();
    const chapterList = player.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Chapters$/ }) });
    if ((await chapterList.getAttribute('open')) === null) await chapterList.locator('summary').click();
    receipt.phase = 'chapter-playback';
    const selectChapter = async (title: string) => {
      const chapter = ready.find(chapter => chapter.title.includes(title))!;
      const previous = (await read<Manifest>(page, manifestPath)).body;
      const previousAudio = await nativeState(player.locator('audio'));
      await chapterList.getByRole('button', { name: new RegExp(title) }).click();
      await expect.poll(async () => {
        const state = await nativeState(player.locator('audio'));
        return state.source?.startsWith('blob:') && state.readyState >= 2 && !state.errorCode &&
          (previous?.listenerState.currentChapterId === chapter.id || state.source !== previousAudio.source);
      }).toBe(true);
      await expect.poll(async () => (await read<Manifest>(page, manifestPath)).body?.listenerState.currentChapterId).toBe(chapter.id);
      return chapter;
    };
    const played = [];
    for (const title of titles) {
      const chapter = await selectChapter(title);
      const playback = await verifyPlayback(player, expect);
      played.push({ chapterId: chapter.id, title, playback });
    }
    receipt.checks.chapters = played;
    const middle = ready.find(chapter => chapter.title.includes('Middle'))!;
    await selectChapter('Middle');
    const pause = player.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.isVisible()) await pause.click();
    await player.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
    const slider = player.getByRole('slider', { name: 'Chapter position' });
    await slider.focus(); await slider.press('Home');
    for (let i = 0; i < 4; i += 1) await slider.press('ArrowRight');
    await expect.poll(async () => (await nativeState(player.locator('audio'))).currentTime).toBeGreaterThanOrEqual(1.5);
    await player.getByRole('button', { name: /^Bookmark / }).click();
    let checkpoint: Manifest | null = null;
    await expect.poll(async () => {
      checkpoint = (await read<Manifest>(page, manifestPath)).body;
      return checkpoint?.listenerState.currentChapterId === middle.id && checkpoint.listenerState.playbackRate === 1.5 && checkpoint.bookmarks.some(b => b.chapterId === middle.id && b.timeSeconds >= 1.5);
    }).toBe(true);
    const savedCheckpoint = checkpoint! as Manifest;
    const bookmark = savedCheckpoint.bookmarks.find(b => b.chapterId === middle.id)!;
    const downloadFull = async (p: Page, filename: string) => {
      const event = p.waitForEvent('download');
      await p.getByRole('button', { name: /^Download full / }).first().click();
      const downloaded = await event; expect(await downloaded.failure()).toBeNull();
      const path = resolve(directory, filename + '-' + downloaded.suggestedFilename());
      await downloaded.saveAs(path); const bytes = await readFile(path);
      expect(bytes.length).toBeGreaterThan(1000);
      return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    };
    const fullAudio = await downloadFull(page, 'created');
    receipt.phase = 'fresh-login-persistence';
    const restored = await fresh(); cleanupPage = restored;
    await restored.goto('/notebook/' + id); await openStudio(restored, expect);
    await restored.getByTestId('audiobook-studio-card').click();
    await expect(restored.getByTestId('audiobook-saved-render')).toBeVisible();
    const restoredPlayer = restored.getByTestId('audiobook-chapter-player');
    await expect(restoredPlayer).toBeVisible();
    await expect(restoredPlayer.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5');
    const persisted = (await read<Manifest>(restored, manifestPath)).body!;
    expect(persisted.renderId).toBe(manifest.renderId);
    expect(persisted.listenerState.currentChapterId).toBe(middle.id);
    expect(persisted.bookmarks.find(b => b.id === bookmark.id)).toEqual(bookmark);
    const bookmarkList = restoredPlayer.locator('details').filter({ has: restored.locator('summary').filter({ hasText: /Bookmarks/ }) });
    await bookmarkList.locator('summary').click();
    await bookmarkList.getByRole('button', { name: /Middle/ }).click();
    await expect.poll(async () => {
      const state = await nativeState(restoredPlayer.locator('audio'));
      return state.readyState >= 2 && state.playbackRate === 1.5 && Math.abs(state.currentTime - bookmark.timeSeconds) < 1.5;
    }).toBe(true);
    const restoredAudio = await downloadFull(restored, 'restored');
    expect(restoredAudio.sha256).toBe(fullAudio.sha256);
    receipt.checks.persistence = { freshLogin: true, sameRender: true, bookmark: true, nativeRate: 1.5, sameDownload: true };
    receipt.checks.download = { byteLength: fullAudio.byteLength, sha256: fullAudio.sha256 };
    receipt.phase = 'actual-download-transcription';
    await restored.reload();
    await restored.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sourceCreated = restored.waitForResponse(r => new URL(r.url()).pathname === '/api/notebooks/' + id + '/sources' && r.request().method() === 'POST');
    const chooser = restored.waitForEvent('filechooser');
    await restored.getByRole('button', { name: 'Browse files', exact: true }).click();
    await (await chooser).setFiles(fullAudio.path);
    const sourceAcknowledged = await sourceCreated;
    expect(sourceAcknowledged.status()).toBe(201);
    const transcribedId = (await sourceAcknowledged.json()).id as string;
    let transcribed: SharedSource | undefined;
    await expect.poll(async () => {
      transcribed = (await getSources(restored)).find(source => source.id === transcribedId);
      return !!transcribed && ['completed', 'degraded'].includes(transcribed.processingStatus) && transcribed.content.length > 50;
    }, { timeout: 180_000 }).toBe(true);
    // Inspect the real persisted narration script, never substitute fixture text for generated speech.
    receipt.checks.audiobookSubstep = 'owner-saved-narration';
    const narrationParts: string[] = [];
    for (const chapter of ready) {
      const saved = await read<{ fileName: string; renderId: string; chapterId: string; narrationText: string }>(restored,
        '/api/audiobook/books/' + encodeURIComponent(savedFile) + '/narration/' + encodeURIComponent(chapter.id) + '?renderId=' + encodeURIComponent(manifest.renderId));
      expect(saved.status).toBe(200);
      expect(saved.body.fileName).toBe(savedFile);
      expect(saved.body.renderId).toBe(manifest.renderId);
      expect(saved.body.chapterId).toBe(chapter.id);
      expect(saved.body.narrationText.length).toBeGreaterThan(0);
      narrationParts.push(saved.body.narrationText);
    }
    const narration = narrationParts.join('\n');
    const fidelity = compareFacts(facts, bookSource!.content, narration, transcribed!.content);
    expect(fidelity).toHaveLength(facts.length);
    for (const fact of fidelity) {
      expect(fact.source, fact.id + ' source').toBe(true);
      expect(fact.script, fact.id + ' generated narration').toBe(true);
      expect(fact.speechTranscript, fact.id + ' actual downloaded audio ASR').toBe(true);
      expect(fact.contradicted, fact.id + ' transcript contradiction').toBe(false);
      expect(fact.scriptContradicted, fact.id + ' narration contradiction').toBe(false);
    }
    receipt.checks.fidelity = { facts: fidelity, transcribedSourceId: transcribedId, actualDownloadSha256: fullAudio.sha256, transcriptionSha256: createHash('sha256').update(transcribed!.content).digest('hex') };
    receipt.checks.scope = { sharedExistingAccountOnly: true, ownNotebookAndBookOnly: true, encryptedSync: 'physically-blocked-out-of-scope' };
    expect(receipt.deniedRequests.filter(request => !request.quarantined)).toEqual([]);
    expect(receipt.checks.activeRouteErrors || 0).toBe(0);
    receipt.phase = 'verified';
  } catch (caught) {
    if (receipt.phase === 'new-notebook' && cleanupPage) {
      const page = cleanupPage;
      // Fixed UI booleans and HTTP codes only: no account text, URLs, headers or raw errors.
      receipt.checks.newNotebookReadiness = {
        pageClosed: page.isClosed(),
        atDashboard: !page.isClosed() && new URL(page.url()).origin === origin && new URL(page.url()).pathname === '/',
        loadingNotebooks: await page.getByText('Loading your notebooks...', { exact: true }).isVisible().catch(() => false),
        loadingGrid: await page.getByText('Loading notebooks...', { exact: true }).isVisible().catch(() => false),
        routeLoading: await page.getByText('Loading StudyPod…', { exact: true }).isVisible().catch(() => false),
        retryVisible: await page.getByRole('button', { name: 'Retry', exact: true }).isVisible().catch(() => false),
        createButtonCount: await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).count().catch(() => 0),
        creatingVisible: await page.getByRole('button', { name: 'Creating...', exact: true }).isVisible().catch(() => false),
        applicationError: await page.getByRole('heading', { name: 'Application Error', exact: true }).isVisible().catch(() => false),
        moduleLoadError: await page.getByRole('heading', { name: 'Part of StudyPod could not load', exact: true }).isVisible().catch(() => false),
        notebookListStatuses: [...notebookListStatuses], notebookListRequestFailures, pageErrors,
      };
    }
    receipt.failure = { name: 'Error', matcher: null, assertion: sharedFailureCategory(caught) };
    throw new Error('Shared audiobook acceptance failed during ' + receipt.phase + '; ' + receipt.failure.assertion);
  } finally {
    let bookDeleteStatus = 0;
    let bookDeleteBody: { deleted?: boolean; fileName?: string } | null = null;
    let bookMetadataStatus = 0;
    let notebookDeleteStatus = 0;
    let notebookReadStatus = 0;
    if (cleanupPage && !cleanupPage.isClosed() && savedFile && policy.files().includes(savedFile)) {
      receipt.checks.audioCleanupStatus = await cleanupPage.evaluate(async file => (await fetch('/api/audiobook/books/' + encodeURIComponent(file) + '/audio', { method: 'DELETE' })).status, savedFile).catch(() => 0);
      const bookDeleted = await cleanupPage.evaluate(async file => {
        const response = await fetch('/api/audiobook/books/' + encodeURIComponent(file), { method: 'DELETE' });
        const body = response.ok ? await response.json() as { deleted?: boolean; fileName?: string } : null;
        return { status: response.status, body };
      }, savedFile).catch(() => ({ status: 0, body: null }));
      bookDeleteStatus = bookDeleted.status; bookDeleteBody = bookDeleted.body;
      bookMetadataStatus = (await read(cleanupPage, '/api/audiobook/books/' + encodeURIComponent(savedFile) + '/playback-manifest').catch(() => ({ status: 0 }))).status;
    }
    if (id && cleanupPage && !cleanupPage.isClosed()) {
      notebookDeleteStatus = await cleanupPage.evaluate(async notebookId => (await fetch('/api/notebooks/' + notebookId, { method: 'DELETE' })).status, id).catch(() => 0);
      notebookReadStatus = (await read(cleanupPage, '/api/notebooks/' + id).catch(() => ({ status: 0 }))).status;
      const verified = verifyAudiobookCleanup({ fileName: savedFile, registeredFiles: policy.files(), bookDeleteStatus, bookDeleteBody, bookMetadataStatus, notebookDeleteStatus, notebookReadStatus });
      receipt.checks.notebookCleanup = { status: verified.notebook, deleteStatus: notebookDeleteStatus, readStatus: notebookReadStatus };
      receipt.checks.bookUploadCleanup = { status: verified.book, fileName: savedFile || null, ownership: savedFile ? 'captured-from-this-run-extraction' : 'not-created', deleteStatus: bookDeleteStatus, acknowledgedExactFile: bookDeleteBody?.deleted === true && bookDeleteBody.fileName === savedFile, metadataReadStatus: bookMetadataStatus };
      receipt.cleanup = verified.cleanup;
    }
    await writeFile(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('shared-account-receipt', { body: Buffer.from(JSON.stringify(receipt)), contentType: 'application/json' });
    for (const context of contexts) { closingContexts.add(context); await context.close(); }
    if (!receipt.failure) expect(receipt.cleanup).toBe('verified-deleted');
  }
});
