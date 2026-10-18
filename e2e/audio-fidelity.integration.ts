import { expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadManifest, compareFacts, wordErrorRate, sha256, auditCedarAudioGrounding } from './audio-fidelity.helpers.mjs';
import { formatDisplayTitle } from '../src/lib/utils/displayTitle';

interface SavedSource { id: string; title: string; content: string; processingStatus: string; metadata?: unknown }

function persistedExtractionMetadata(value: unknown): { model: string | null; extractionMethod: string | null } {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { model: null, extractionMethod: null };
  const metadata = parsed as Record<string, unknown>;
  return { model: typeof metadata.model === 'string' ? metadata.model : null,
    extractionMethod: typeof metadata.extractionMethod === 'string' ? metadata.extractionMethod : null };
}

export async function verifyGeneratedAudioFidelity(page: Page, context: BrowserContext, manifestPath: string) {
  expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
  expect(process.env.STUDYPOD_AUDIO_PROVIDER_SLOT).toBe('1');
  expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
  const { manifest, audio, source, script, format } = loadManifest(resolve(manifestPath));
  const directory = resolve('.ai-bridge/studypod-renewal-20261012/audio-studio-coverage', `fidelity-${Date.now()}-${manifest.kind}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'source.txt'), source);
  writeFileSync(resolve(directory, 'spoken-script.txt'), script);
  const receipt: Record<string, unknown> & { blockedTextGeneration: number } = { phase: 'signup', status: 'running', kind: manifest.kind,
    audioSha256: sha256(audio), sourceSha256: sha256(source), scriptSha256: sha256(script),
    generationReceipt: manifest.generationReceipt || null, blockedTextGeneration: 0,
    limits: ['Whisper errors require listening adjudication; recovered facts alone do not prove all speech intelligible.',
      'Playback was checked separately by the generating audio gate.', 'No cloud site or paid provider validation.'] };
  const save = () => writeFileSync(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const showSources = async () => {
    const heading = page.getByRole('heading', { name: 'Sources', exact: true });
    const tab = page.getByRole('tab', { name: /(?:^|\s)Sources$/ });
    await expect(heading.or(tab).first()).toBeVisible();
    if (!(await heading.isVisible())) await tab.click();
    await expect(heading).toBeVisible();
  };
  // Prevent ingestion's automatic text enrichment and foreground provider calls.
  // CRUD/auth remain real; ASR and saved source are never mocked.
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4182') return route.abort();
    const forbidden = /\/ai\/|\/immerse$|\/signal(?:\/|$)|\/chat$|\/research$|\/discover$/.test(url.pathname);
    if (forbidden) { receipt.blockedTextGeneration++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  try {
    save();
    await page.goto('/auth?mode=cloud-signup');
    expect(new URL(page.url()).origin).toBe('http://127.0.0.1:4182');
    const identity = randomUUID();
    const email = `fidelity-${identity}@studypod.invalid`;
    await page.getByLabel('Display Name').fill(`Audio fidelity ${identity}`);
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
    await page.locator('#tosAccepted').click();
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect.poll(async () => {
      const response = await context.request.get('/api/user/profile');
      return response.ok() ? (await response.json()).user.email : null;
    }).toBe(email);
    await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
    await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    const id = new URL(page.url()).pathname.split('/').pop();
    const profile = await (await context.request.get('/api/user/profile')).json();
    const notebook = await (await context.request.get(`/api/notebooks/${id}`)).json();
    expect(notebook.userId).toBe(profile.user.id);
    await showSources();
    await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
    receipt.phase = 'actual-audio-upload'; save();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Browse files', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: `generated-${manifest.kind}.${format[0]}`, mimeType: format[1], buffer: audio });
    receipt.visibleFilePickerUsed = true; save();
    let saved: SavedSource | undefined;
    await expect.poll(async () => {
      const response = await context.request.get(`/api/notebooks/${id}/sources`);
      const data = await response.json(); saved = (data.sources || data)[0];
      if (saved?.content?.trim()) {
        writeFileSync(resolve(directory, 'transcript.txt'), saved.content);
        receipt.processingStatus = saved.processingStatus;
        save();
      }
      return Boolean(saved?.content?.trim() && ['completed', 'degraded'].includes(saved.processingStatus));
    }, { timeout: 180_000, message: 'Real saved generated media must yield a persisted speech transcript' }).toBe(true);
    if (!saved?.content) throw new Error('Saved speech transcript missing');
    const transcriptSource = saved;
    const extractionMetadata = persistedExtractionMetadata(transcriptSource.metadata);
    receipt.modelSelectionObserved = extractionMetadata.model;
    receipt.extractionMethodObserved = extractionMetadata.extractionMethod;
    receipt.modelObservationSource = 'persisted-completed-source-metadata';
    const comparedFacts = compareFacts(manifest.facts, source, script, transcriptSource.content);
    receipt.facts = comparedFacts;
    const scriptGrounding = auditCedarAudioGrounding(source, script);
    const speechGrounding = auditCedarAudioGrounding(source, transcriptSource.content);
    receipt.fixtureGrounding = { script: scriptGrounding, actualAsr: speechGrounding };
    receipt.scriptToAsrWordErrorRateDiagnostic = wordErrorRate(script, saved.content);
    receipt.phase = 'semantic-fact-gate'; save();
    expect(transcriptSource.processingStatus, 'Real audio extraction must complete before model metadata is accepted').toBe('completed');
    expect(extractionMetadata.extractionMethod, 'Saved source must identify real browser Whisper transcription').toBe('whisper-browser-transcription');
    expect(extractionMetadata.model, 'Completed extraction must persist the exact actual Whisper pipeline model').toBe('onnx-community/whisper-base');
    expect(comparedFacts.filter((fact) => !fact.script || fact.scriptContradicted), 'Required source facts omitted/contradicted by generated script').toEqual([]);
    expect(comparedFacts.filter((fact) => !fact.speechTranscript || fact.contradicted), 'Required facts missing/contradicted in actual speech ASR').toEqual([]);
    expect(scriptGrounding.passed, 'Generated script contains unsupported or unreviewed Cedar audio propositions; adjudication required').toBe(true);
    expect(speechGrounding.passed, 'Actual speech ASR contains unsupported or unreviewed Cedar audio propositions; adjudication required').toBe(true);
    const openAndCheckViewer = async () => {
      await showSources();
      await page.locator('span.text-sm.font-medium').filter({ hasText: new RegExp(`^${formatDisplayTitle(transcriptSource.title, 'Untitled source').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
      // Check the actual rendered source, rather than mistaking API persistence for UI usability.
      const viewer = page.locator('.prose').filter({ hasText: new RegExp(manifest.facts[0].pattern, 'i') }).first();
      await expect(viewer).toBeVisible();
      for (const fact of manifest.facts) await expect(viewer).toContainText(new RegExp(fact.pattern, 'i'));
      const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
      await expect.poll(async () => normalize(await viewer.innerText())).toContain(normalize(transcriptSource.content));
    };
    receipt.phase = 'source-viewer'; save();
    await openAndCheckViewer(); receipt.viewerTranscriptVisible = true; save();
    await page.reload();
    const response = await context.request.get(`/api/notebooks/${id}/sources`);
    const data = await response.json();
    expect((data.sources || data).find((entry: SavedSource) => entry.id === transcriptSource.id)?.content).toBe(transcriptSource.content);
    await openAndCheckViewer(); receipt.reopenedViewerTranscriptVisible = true;
    receipt.reloadedPersistence = true; receipt.status = 'passed'; receipt.phase = 'finished'; save();
    return { status: 'passed', receiptPath: resolve(directory, 'receipt.json'), audioSha256: sha256(audio), facts: comparedFacts };
  } catch (error) {
    receipt.status = 'failed'; receipt.failureType = error instanceof Error ? error.name : 'UnknownError';
    // Do not persist arbitrary browser/backend exception text or credentials.
    save(); throw error;
  }
}
