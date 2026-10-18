import { holdPlayingNativeAudio, observeHeldNativeDisposal, nativeDisposalEvidencePassed } from './native-disposal-oracle';
import { acceptanceReceipt, cancelTransportEvidenceValid } from './acceptance-contracts.mjs';
import { test, expect, type Locator, type Page, type BrowserContext, type Response } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { content } from './full-flow-fixtures.mjs';
import { verifyGeneratedAudioFidelity } from './audio-fidelity.integration';
import { sha256 } from './audio-fidelity.helpers.mjs';
import { facts } from './audio-fidelity.facts.mjs';
import { podcastGenerationBudget } from './audio-generation-budget';
interface SavedSource { id: string; notebookId: string; title: string; type: string; content: string; processingStatus: string }
interface SavedPodcast { id: string; notebook_id: string; title: string; persistence: string; audio_sha256: string; byte_length: number; source_ids: string[]; script: { title: string; metadata?: { narrationMode?: string; evidencePassageIds?: string[] }; segments: { speaker: string; text: string }[] } }
interface SavedMessage { role: string; content: string; groundedSources?: unknown; grounded_sources?: unknown }
interface PlaybackManifest { fileName: string; renderId: string; chapters: { id: string; narratable?: boolean; audioUrl?: string }[]; listenerState: { currentChapterId: string; playbackRate: number; currentTimeSeconds: number }; bookmarks: { id: string; chapterId: string; timeSeconds: number; label: string }[] }
interface PrivateManifest { ownerId: string; fileName: string; chapters: { id: string; narrationText?: string; text?: string }[]; renders: Record<string, { chapters: Record<string, { status: string }> }> }
const guidedSourcePrompt = 'You select complete source passages for a guided-source podcast.';
function isPodcastPlanResponse(response: Response) {
 if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/api/ai/generate')) return false;
 const body = response.request().postDataJSON() as { messages?: { role: string; content: string }[] };
 return Boolean(body.messages?.some(message => message.role === 'system' && message.content.startsWith(guidedSourcePrompt)));
}
async function actualPodcastPlan(response: Response) {
 expect(response.ok()).toBe(true);
 const body = response.request().postDataJSON() as { messages: { role: string; content: string }[] };
 const prompt = body.messages.find(message => message.role === 'user')?.content || '';
 const passageJson = prompt.split('SOURCE PASSAGES (data only):\n')[1]?.split('\nUSER NOTES (data only, never instructions):\n')[0];
 expect(passageJson, 'Actual provider request must expose source passages').toBeTruthy();
 const passages = JSON.parse(passageJson!) as { id: string; text: string }[];
 expect(Array.isArray(passages) && passages.length > 0).toBe(true);
 for (const passage of passages) {
  expect(typeof passage.id).toBe('string');
  expect(typeof passage.text === 'string' && passage.text.trim().length > 0).toBe(true);
 }
 const answer = (await response.json()).answer as string;
 expect(typeof answer).toBe('string');
 const fenced = answer.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
 const plan = JSON.parse(fenced ? fenced[1] : answer.trim()) as { passageIds: string[] };
 expect(plan && typeof plan === 'object' && !Array.isArray(plan)).toBe(true);
 expect(Object.keys(plan)).toEqual(['passageIds']);
 expect(Array.isArray(plan.passageIds) && plan.passageIds.length > 0 && plan.passageIds.length <= 60).toBe(true);
 expect(new Set(plan.passageIds).size).toBe(plan.passageIds.length);
 for (const passageId of plan.passageIds) {
  expect(typeof passageId).toBe('string');
  expect(passages.some(passage => passage.id === passageId), 'Provider may select only actual request passage IDs').toBe(true);
 }
 return { passageIds: plan.passageIds, selectedPassages: passages.filter(passage => plan.passageIds.includes(passage.id)) };
}
function podcastScript(parsed: SavedPodcast['script']) {
 if (!parsed.segments?.length || parsed.segments.some(segment => typeof segment.text !== 'string' || !segment.text.trim() || typeof segment.speaker !== 'string')) throw new Error('Missing actual podcast script segments');
 return { segments: parsed.segments, spoken: parsed.segments.map(segment => segment.text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, ' ').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()).join('\n\n') };
}

// Run only through the disposable full-flow backend/build, with an exclusive
// local-provider slot. Never use the shared preview or a cloud account.
// Each scenario owns a fresh account; runner workers=1 controls provider concurrency.
const fact = /(?:17|seventeen) blue trays/i;
const root = resolve('.ai-bridge/studypod-renewal-20261012/audio-studio-coverage');

// Never retain raw TTS text: worker logs and progress can quote narration.
function audioConsoleCategory(text: string): string | null {
  // These actual generator messages have no TTS-prefixed logger name.
  if (/Falling back to Web Speech API/i.test(text)) return 'web-speech-fallback';
  if (/Failed to generate segment \d+|Speech synthesis error/i.test(text)) return 'synthesis-failed';
  if (/Generated audio, duration=/i.test(text)) return 'worker-audio-generated';
  if (/Generating with voice=/i.test(text)) return 'worker-synthesis-started';
  if (!/(?:kokoro|tts|onnx|ort-wasm|sharedarraybuffer|streamingttsgenerator)/i.test(text)) return null;
  if (/SharedArrayBuffer not available/i.test(text)) return 'shared-array-buffer-unavailable';
  if (/TTS Worker error/i.test(text)) return 'worker-error';
  if (/Failed to initialize|initialization.*(?:failed|timeout)/i.test(text)) return 'model-initialization-failed';
  if (/synthesis error|synthesis failed|generation failed|Failed to generate segment/i.test(text)) return 'synthesis-failed';
  if (/Audio validation error|Failed to combine audio|No valid blobs/i.test(text)) return 'audio-validation-failed';
  if (/Loading Kokoro|Initializing.*model/i.test(text)) return 'model-loading';
  if (/Kokoro.*ready/i.test(text)) return 'model-ready';
  if (/(?:onnx|ort-wasm).*(?:error|failed)/i.test(text)) return 'onnx-runtime-error';
  return null;
}

function diagnosticAsset(rawUrl: string): { url: string; asset: string } | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (['cas-bridge.xethub.hf.co', 'cas-server.xethub.hf.co', 'transfer.xethub.hf.co'].includes(url.hostname)) {
      return { url: `${url.protocol}//${url.hostname}/[model-transfer]`, asset: 'model-transfer' };
    }
    // Public static filenames only; no API, notebook, account or source URLs.
    const file = url.pathname.split('/').pop() || '';
    const local = url.hostname === '127.0.0.1' && /^\/(?:assets|models|voices)\//.test(url.pathname);
    const publicModel = ['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co', 'cdn-lfs-eu-1.huggingface.co', 'cdn.jsdelivr.net'].includes(url.hostname);
    if (!local && !publicModel) return null;
    const worker = local && /^ttsWorkerScript[-.\w]*\.js$/.test(file);
    const model = /^[\w.-]+\.(?:onnx|wasm)$/.test(file);
    const voice = /^[ab][fm]_[a-z]+\.bin$/.test(file);
    const modelBin = /^(?:model(?:[-.\w]*)|pytorch_model)\.bin$/.test(file);
    const config = /^(?:config|tokenizer|tokenizer_config|generation_config|special_tokens_map|preprocessor_config)\.json$/.test(file);
    const ort = /^ort[-.\w]*\.(?:mjs|js)$/.test(file);
    if (!worker && !model && !voice && !modelBin && !config && !ort) return null;
    // Deliberately omit intermediate CDN/model paths as well as query/hash/userinfo.
    return { url: `${url.protocol}//${url.host}/[static-asset]/${file}`, asset: worker ? 'tts-worker' : voice ? 'voice-bin' : modelBin ? 'model-bin' : config ? 'model-config' : ort ? 'ort-runtime' : file.endsWith('.wasm') ? 'wasm' : 'onnx' };
  } catch { return null; }
}

async function observeAudioWorker(page: Page) {
  await page.addInitScript(() => {
    type EventRecord = { event: string; elapsedMs: number; percentage?: number; bytes?: number; duration?: number; stage?: string; requestScoped?: boolean };
    const state = globalThis as typeof globalThis & { __studyPodAudioWorkerEvents?: EventRecord[] };
    const events: EventRecord[] = [];
    state.__studyPodAudioWorkerEvents = events;
    const started = performance.now();
    const record = (event: string, fields: Omit<EventRecord, 'event' | 'elapsedMs'> = {}) => {
      if (events.length < 200) events.push({ event, elapsedMs: Math.round(performance.now() - started), ...fields });
    };
    const NativeWorker = globalThis.Worker;
    // Observe transport only. Native constructor, requests and responses are unchanged.
    globalThis.Worker = class extends NativeWorker {
      private readonly audioWorker: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.audioWorker = /^ttsWorkerScript[-.\w]*\.js$/.test(new URL(String(url), location.href).pathname.split('/').pop() || '');
        if (!this.audioWorker) return;
        record('worker-created');
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (!event.data || typeof event.data !== 'object') return;
          const data = event.data as Record<string, unknown>;
          if (!['ready', 'progress', 'audio', 'error', 'webgpu-status'].includes(String(data.type))) return;
          const message = typeof data.message === 'string' ? data.message : '';
          const stage = /loading/i.test(message) ? 'model-loading' : /initializ/i.test(message) ? 'model-initializing'
            : /generat|synthes/i.test(message) ? 'synthesis' : /ready/i.test(message) ? 'ready' : undefined;
          record(`response-${String(data.type)}`, {
            requestScoped: typeof data.id === 'string', stage,
            percentage: typeof data.percentage === 'number' && Number.isFinite(data.percentage) ? data.percentage : undefined,
            bytes: data.audioData instanceof ArrayBuffer ? data.audioData.byteLength : undefined,
            duration: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : undefined,
          });
        });
        this.addEventListener('error', () => record('worker-error'));
        this.addEventListener('messageerror', () => record('worker-messageerror'));
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        if (this.audioWorker && message && typeof message === 'object') {
          const type = (message as { type?: unknown }).type;
          if (['init', 'synthesize', 'cancel', 'checkWebGPU'].includes(String(type))) record(`request-${String(type)}`);
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate(): void {
        if (this.audioWorker) record('worker-terminated');
        super.terminate();
      }
    };
  });
}

async function audioUiDiagnostic(page: Page) {
  return page.evaluate(() => {
    const status = document.querySelector('.generating-status')?.textContent || '';
    const stage = /initializ|loading.*model/i.test(status) ? 'model-loading'
      : /retry/i.test(status) ? 'segment-retry'
      : /generat|processing segments|prepared/i.test(status) ? 'segment-generation'
      : /ready.*play/i.test(status) ? 'ready'
      : /prepar/i.test(status) ? 'preparing'
      : /(?:speaker|host|guest|narrator|voice).*[:\u201c"]|["\u201c].*\.\.\./i.test(status) ? 'segment-synthesis' : status ? 'unclassified-status' : 'no-status';
    const percent = document.querySelector('.generating-percent, .minimized-percent')?.textContent?.match(/^(\d+(?:\.\d+)?)%$/)?.[1];
    const segment = status.match(/\((\d+)\/(\d+)\)/);
    const toasts = Array.from(document.querySelectorAll('[toast-close]')).slice(0, 10).map(close => {
      const node = close.closest('li');
      const title = node?.querySelector('.text-sm.font-semibold')?.textContent?.trim() || '';
      const description = node?.querySelector('.text-sm.opacity-90')?.textContent || '';
      return { title: ['Audio generation failed', 'Generation Failed', 'Generation Cancelled'].includes(title) ? title : 'other-toast',
        category: /timeout|timed out/i.test(description) ? 'timeout' : /silence|silent/i.test(description) ? 'silent-audio' : /corrupt|invalid.*audio/i.test(description) ? 'invalid-audio' : /worker/i.test(description) ? 'worker-failure' : /model|onnx|kokoro/i.test(description) ? 'model-failure' : 'unclassified',
        state: node?.getAttribute('data-state') === 'open' ? 'open' : 'closed' };
    });
    return { crossOriginIsolated: globalThis.crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', webGpuApi: 'gpu' in navigator,
      generatingCardPresent: Boolean(document.querySelector('[data-testid="podcast-generating-card"]')), minimizedPresent: Boolean(document.querySelector('.podcast-minimized')),
      podcastPlayerPresent: Boolean(document.querySelector('.podcast-player-container')), stage,
      percent: percent ? Number(percent) : null, segment: segment ? { current: Number(segment[1]), total: Number(segment[2]) } : null, toasts,
      workerEvents: (globalThis as typeof globalThis & { __studyPodAudioWorkerEvents?: unknown[] }).__studyPodAudioWorkerEvents || [] };
  });
}

async function tab(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) >= 1100) return;
  const target = page.getByRole('tab', { name: new RegExp(`(?:^|\\s)${name}$`) });
  await expect(target).toBeVisible();
  await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
}

// The history button resolves before its async blob load. Readiness of the old
// element must not admit a Play click intended for the newly selected episode.
function savedHistoryReplayReady(state: { sourceChanged: boolean; sourceMatches: boolean; paused: boolean; duration: number; readyState: number; errorCode: number | null }) {
  return state.sourceChanged && state.sourceMatches && state.paused &&
    Number.isFinite(state.duration) && state.duration > 3 && state.readyState >= 2 && state.errorCode === null;
}

async function playback(player: Locator, diagnosticPhase?: 'saved-history-replay') {
  const audio = player.locator('audio');
  await expect(audio).toHaveCount(1);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) =>
    Number.isFinite(node.duration) && node.duration > 3 && node.readyState >= 2 && !node.error),
  { timeout: 30_000, message: 'Real generated media must load and decode' }).toBe(true);
  const nativeState = async () => {
    try {
      return {
        ...(await audio.evaluate((node: HTMLAudioElement) => ({
          paused: node.paused, ended: node.ended, currentTime: node.currentTime,
          duration: node.duration, readyState: node.readyState,
          networkState: node.networkState, errorCode: node.error?.code ?? null,
          playbackRate: node.playbackRate,
        }), undefined, { timeout: 1_000 })),
        playButton: await player.getByRole('button', { name: 'Play', exact: true }).count(),
        pauseButton: await player.getByRole('button', { name: 'Pause', exact: true }).count(),
      };
    } catch {
      return { unavailable: true as const };
    }
  };
  const before = diagnosticPhase ? await nativeState() : null;
  if (await player.getByRole('button', { name: 'Pause', exact: true }).count()) {
    await player.getByRole('button', { name: 'Pause', exact: true }).click();
  }
  const beforePlay = diagnosticPhase ? await nativeState() : null;
  const playbackStart = await audio.evaluate((node: HTMLAudioElement) => node.currentTime);
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  if (diagnosticPhase) {
    try {
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement, start) => !node.paused && node.currentTime > 0.2 && node.currentTime > start + 0.2, playbackStart), { message: 'UI Play must advance real media beyond its captured checkpoint' }).toBe(true);
    } catch {
      throw new Error(`Saved-history native replay failed advancing media: ${JSON.stringify({ playbackStart, before, beforePlay, after: await nativeState() })}`);
    }
  } else {
    await expect.poll(() => audio.evaluate((node: HTMLAudioElement, start) => !node.paused && node.currentTime > 0.2 && node.currentTime > start + 0.2, playbackStart), { message: 'UI Play must advance real media beyond its captured checkpoint' }).toBe(true);
  }
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  const slider = player.getByRole('slider', { name: /playback position|Chapter position/ });
  await slider.focus(); await slider.press('Home');
  for (let i = 0; i < 4; i++) await slider.press('ArrowRight');
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(1.5);
  return audio.evaluate((node: HTMLAudioElement) => ({ duration: node.duration, paused: node.paused, position: node.currentTime, readyState: node.readyState }));
}

async function manifestRecord(context: BrowserContext, url: string) {
  const response = await context.request.get(url);
  expect(response.ok(), 'Owner must read the actual saved audiobook manifest').toBe(true);
  return response.json() as Promise<PlaybackManifest>;
}

async function reopenAudio(page: Page, kind: 'podcast' | 'audiobook') {
  await page.reload();
  await tab(page, 'Studio');
  if (kind === 'audiobook') {
    await page.getByTestId('audiobook-studio-card').click();
  } else {
    // Studio restores the saved podcast directly; generation opens new settings.
    await expect(page.locator('.podcast-player-container')).toBeVisible();
  }
}

async function seekCheckpoint(player: Locator) {
  const audio = player.locator('audio');
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState >= 2 && node.duration > 12)).toBe(true);
  if (await player.getByRole('button', { name: 'Pause', exact: true }).count()) {
    await player.getByRole('button', { name: 'Pause', exact: true }).click();
  }
  const slider = player.getByRole('slider', { name: /playback position|Chapter position/ });
  await slider.focus(); await slider.press('Home');
  for (let i = 0; i < 8; i++) await slider.press('ArrowRight');
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(3);
  return audio.evaluate((node: HTMLAudioElement) => node.currentTime);
}

// Observable media contracts: a restored dropdown/server row alone is insufficient.
async function assertLoadedChapter(player: Locator, context: BrowserContext, chapter: PlaybackManifest['chapters'][number], rate: number) {
  if (!chapter.audioUrl) throw new Error('Expected chapter must have actual owned audio');
  const expected = await context.request.get(chapter.audioUrl);
  expect(expected.ok()).toBe(true);
  const expectedHash = sha256(await expected.body());
  await expect.poll(() => player.locator('audio').evaluate((audio: HTMLAudioElement) =>
    audio.readyState >= 2 && Number.isFinite(audio.duration) && audio.duration > 3 && !audio.error)).toBe(true);
  await expect.poll(() => player.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    if (!audio.currentSrc || audio.readyState < 2) return null;
    const bytes = await (await fetch(audio.currentSrc)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }), { message: 'Expected chapter bytes must replace any previously loaded chapter' }).toBe(expectedHash);
  await expect.poll(() => player.locator('audio').evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(rate);
  const loaded = await player.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    // Read the already loaded blob; this does not change authentication or media state.
    const bytes = await (await fetch(audio.currentSrc)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const decoder = new AudioContext();
    try {
      const decoded = await decoder.decodeAudioData(bytes.slice(0));
      return { hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
        duration: audio.duration, decodedDuration: decoded.duration, rate: audio.playbackRate, paused: audio.paused };
    } finally { await decoder.close(); }
  });
  expect(loaded.hash, 'Loaded media must be the expected owned chapter bytes').toBe(expectedHash);
  expect(Math.abs(loaded.duration - loaded.decodedDuration), 'Media metadata must describe the loaded chapter').toBeLessThan(0.1);
  expect(loaded.rate, 'Actual audio speed must match persisted speed').toBe(rate);
  return { chapterId: chapter.id, sha256: loaded.hash, duration: loaded.duration, rate: loaded.rate, paused: loaded.paused };
}

type ProfileMenuDiagnostic = {
  phase: 'trigger' | 'open-menu' | 'sign-out' | 'logout';
  expanded: 'true' | 'false' | 'missing' | 'unavailable';
  menuVisible: boolean;
  signOutVisible: boolean;
};

async function signOutThroughProfile(page: Page, recordFailure: (state: ProfileMenuDiagnostic) => void) {
  // Both isolated account display names start Audio; fresh context has no custom name.
  // Radix modal content hides the trigger from default accessibility queries while open.
  const avatar = page.getByRole('button', { name: 'AU', exact: true, includeHidden: true });
  // Match the visible label inside the accessible item; icon pseudo-content may prefix its name.
  const signOut = page.getByRole('menuitem').filter({ has: page.getByText('Sign out', { exact: true }) });
  const menu = page.getByRole('menu').filter({ has: signOut });
  let phase: ProfileMenuDiagnostic['phase'] = 'trigger';
  try {
    await expect(avatar).toHaveCount(1);
    phase = 'open-menu';
    // Radix toggles on pointerdown: clicking an already open trigger closes it.
    // A force-mounted menu exists while closed, so use visibility, not DOM count.
    if (await avatar.getAttribute('aria-expanded') !== 'true' && !await signOut.isVisible()) {
      await avatar.click();
    }
    await expect(avatar).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expect(signOut).toBeVisible();
    phase = 'sign-out';
    await signOut.click();
    phase = 'logout';
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByTestId('audiobook-chapter-player')).toHaveCount(0);
    await expect(page.locator('audio')).toHaveCount(0);
  } catch (error) {
    // Retain fixed UI states only: never read account labels, storage, or URLs.
    let expanded: ProfileMenuDiagnostic['expanded'] = 'unavailable';
    try {
      const value = await avatar.getAttribute('aria-expanded', { timeout: 1000 });
      expanded = value === 'true' || value === 'false' ? value : 'missing';
    } catch { /* Closed page or missing trigger: keep the fixed sentinel. */ }
    recordFailure({ phase, expanded,
      menuVisible: await menu.isVisible().catch(() => false),
      signOutVisible: await signOut.isVisible().catch(() => false) });
    throw error;
  }
}

async function signInThroughForm(page: Page, context: BrowserContext, email: string) {
  await page.goto('/auth?mode=cloud-login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
  const signedIn = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/auth/signin'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect.poll(async () => { const response = await context.request.get('/api/user/profile'); return response.ok() ? (await response.json()).user.email : null; }).toBe(email);
}

for (const scenario of [
  { kind: 'podcast', intake: 'paste', id: 'studio-audio-podcast' },
  { kind: 'audiobook', intake: 'paste', id: 'studio-audio-audiobook' },
  { kind: 'podcast', intake: 'wav', id: 'studio-audio-upload-wav-podcast' },
  { kind: 'podcast', intake: 'paste', id: 'studio-audio-cancel-retry-podcast' },
] as const) {
  const { kind, intake } = scenario;
  test(`${scenario.id}: owned source, real local generation, playback and download`, async ({ page, context, browser }, info) => {
    test.setTimeout(scenario.id === 'studio-audio-cancel-retry-podcast' ? 900_000 : 720_000);
    expect(process.env.STUDYPOD_FULL_ISOLATED, 'Disposable database/build required').toBe('1');
    expect(process.env.STUDYPOD_AUDIO_PROVIDER_SLOT, 'Exclusive provider slot must be granted explicitly').toBe('1');
    expect(process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro').not.toBe('mock');
    expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
    expect(new URL(process.env.STUDYPOD_BASE_URL || process.env.STUDYPOD_AUTH_BASE_URL || 'http://127.0.0.1:4182').hostname).toBe('127.0.0.1');
    const directory = resolve(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${info.project.name}-${scenario.id}`);
    mkdirSync(directory, { recursive: true });
    const receipt: Record<string, unknown> & { phase: string; pageErrorCount: number } = { kind, phase: 'signup', mockedAuthOrData: false, localOnly: true, pageErrorCount: 0,
      limits: ['Signal and playback checks do not prove pronunciation, intelligibility or spoken factual accuracy.', 'Generated script and actual downloaded speech are checked with browser Whisper-base; ASR alone does not prove complete intelligibility.'] };
    const progress = () => writeFileSync(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
    page.on('pageerror', () => { receipt.pageErrorCount++; });
    const diagnosticStarted = Date.now();
    await observeAudioWorker(page);
    const audioConsole: { category: string; severity: string; elapsedMs: number }[] = [];
    const assetEvents: { url: string; asset: string; phase: string; status?: number; failure?: string; elapsedMs: number }[] = [];
    const jobPollTimes: number[] = [];
    receipt.jobPollTimesMs = jobPollTimes;
    page.on('console', message => {
      const category = audioConsoleCategory(message.text());
      if (category && audioConsole.length < 100) audioConsole.push({ category, severity: message.type(), elapsedMs: Date.now() - diagnosticStarted });
    });
    let podcastSavePosts = 0;
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/notebooks\/[^/]+\/studio\/podcasts$/.test(new URL(request.url()).pathname)) podcastSavePosts++;
      if (new URL(request.url()).pathname.includes('/audiobook/job-status/') && jobPollTimes.length < 1000) {
        jobPollTimes.push(Date.now() - diagnosticStarted);
      }
      const asset = diagnosticAsset(request.url());
      if (asset && assetEvents.length < 160) assetEvents.push({ ...asset, phase: 'requested', elapsedMs: Date.now() - diagnosticStarted });
    });
    page.on('response', response => {
      if (response.request().method() === 'POST' && /\/api\/notebooks\/[^/]+\/studio\/podcasts$/.test(new URL(response.url()).pathname)) {
        receipt.podcastSaveStatus = response.status();
        if (receipt.cancelRetry && response.status() === 201) (receipt.cancelRetry as Record<string, unknown>).saveObservedAt = Date.now();
        progress();
      }
      const asset = diagnosticAsset(response.url());
      if (asset && assetEvents.length < 160) assetEvents.push({ ...asset, phase: 'response', status: response.status(), elapsedMs: Date.now() - diagnosticStarted });
    });
    page.on('requestfailed', request => {
      const asset = diagnosticAsset(request.url());
      // Retain only a recognized transport code, never arbitrary browser error text.
      const failure = request.failure()?.errorText.match(/net::ERR_[A-Z_]+/)?.[0] || 'transport-failed';
      if (asset && assetEvents.length < 160) assetEvents.push({ ...asset, phase: 'failed', failure, elapsedMs: Date.now() - diagnosticStarted });
    });
    try {
      progress();
      await page.goto('/auth?mode=cloud-signup');
      expect(new URL(page.url()).origin).toBe('http://127.0.0.1:4182');
      const identity = randomUUID();
      const email = `audio-${identity}@studypod.invalid`;
      await page.getByLabel('Display Name').fill(`Audio QA ${identity}`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      await expect.poll(async () => {
        const response = await context.request.get('/api/user/profile');
        return response.ok() ? (await response.json()).user.email : null;
      }).toBe(email);
      receipt.accountIdentityVerified = true;
      await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      const id = new URL(page.url()).pathname.split('/').pop();
      const profile = await (await context.request.get('/api/user/profile')).json();
      const ownedNotebook = await context.request.get(`/api/notebooks/${id}`);
      expect(ownedNotebook.ok()).toBe(true);
      const ownedNotebookRecord = await ownedNotebook.json();
      expect(ownedNotebookRecord.userId).toBe(profile.user.id);
      const notebookTitle = ownedNotebookRecord.title as string;
      expect(notebookTitle).toBeTruthy();
      receipt.notebookOwnerVerified = true;
      receipt.initialNotebookTitle = notebookTitle;
      receipt.phase = 'source'; progress();
      await tab(page, 'Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      let uploadedSource: SavedSource | undefined;
      if (intake === 'wav') {
        const fixtureDirectory = process.env.STUDYPOD_FULL_FIXTURES;
        expect(fixtureDirectory, 'Runner must provide real generated fixtures').toBeTruthy();
        const wav = resolve(fixtureDirectory!, 'cedar.wav');
        const wavBytes = readFileSync(wav);
        expect(wavBytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(wavBytes.subarray(8, 12).toString()).toBe('WAVE');
        const created = page.waitForResponse(r => r.request().method() === 'POST'
          && new URL(r.url()).pathname === `/api/notebooks/${id}/sources`, { timeout: 120_000 });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await (await chooser).setFiles(wav);
        const acknowledged = await created;
        expect(acknowledged.status()).toBe(201);
        const acknowledgedId = (await acknowledged.json()).id;
        expect(acknowledgedId).toBeTruthy();
        await expect.poll(async () => {
          const response = await context.request.get(`/api/notebooks/${id}/sources`);
          expect(response.status()).toBe(200);
          const data = await response.json(); const sources = data.sources || data;
          expect(sources).toHaveLength(1);
          uploadedSource = sources[0];
          return uploadedSource!.id === acknowledgedId && uploadedSource!.notebookId === id
            && uploadedSource!.type === 'audio' && fact.test(uploadedSource!.content || '')
            && ['completed', 'degraded'].includes(uploadedSource!.processingStatus);
        }, { timeout: 120_000 }).toBe(true);
        await page.reload(); await tab(page, 'Sources');
        const uploadedSourceCard = page.getByRole('button', { name: `Open source ${uploadedSource!.title}`, exact: true });
        await expect(uploadedSourceCard).toHaveCount(1);
        await expect(uploadedSourceCard).toBeVisible();
        await uploadedSourceCard.click();
        await expect(page.getByRole('heading', { name: `Source: ${uploadedSource!.title}`, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to source list', exact: true })).toBeVisible();
        await expect(page.locator('.prose.prose-gray').filter({ hasText: fact })).toHaveCount(1);
        await expect(page.locator('.prose.prose-gray').filter({ hasText: fact })).toBeVisible();
        receipt.uploadedWav = { sourceId: uploadedSource!.id, notebookId: id,
          inputSha256: sha256(wavBytes), transcriptionSha256: sha256(Buffer.from(uploadedSource!.content)),
          sourceType: uploadedSource!.type, status: uploadedSource!.processingStatus,
          sourcePostStatus: 201, visibleFileChooser: true, reloadViewerFact: true };
      } else {
        await page.getByRole('button', { name: /Pasted Content/ }).click();
        await page.getByLabel('Title', { exact: true }).fill('Cedar synthetic study');
        await page.getByLabel('Content', { exact: true }).fill(content);
        await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      }
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${id}/sources`);
        expect(response.ok()).toBe(true);
        const data = await response.json(); const sources = data.sources || data;
        return sources.some((s: SavedSource) => s.notebookId === id && fact.test(s.content || '') && ['completed', 'degraded'].includes(s.processingStatus));
      }, { timeout: 120_000 }).toBe(true);
      // Background source processing owns the same bounded 45-second local model.
      await page.waitForTimeout(46_000);
      receipt.phase = 'grounded-chat'; progress(); await tab(page, 'Chat');
      const input = page.getByPlaceholder(/Start typing|Ask only/);
      await input.fill('According to the Cedar experiment source, exactly how many blue trays are used? Give the number and cite the source.');
      await input.press('Enter');
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${id}/messages`);
        expect(response.ok()).toBe(true);
        const data = await response.json(); const messages = data.messages || data;
        return messages.some((message: SavedMessage) => message.role === 'assistant' && fact.test(message.content || ''));
      }, { timeout: 65_000, message: 'Persisted assistant answer must retain the source fact' }).toBe(true);
      const citation = page.getByRole('button', { name: /^Citation 1/ }).first();
      await expect(citation).toBeVisible({ timeout: 65_000 });
      await citation.click();
      const evidenceId = await citation.getAttribute('aria-controls'); expect(evidenceId).toBeTruthy();
      await expect(page.locator(`[id="${evidenceId}"]`)).toContainText(fact);
      if (uploadedSource) {
        const response = await context.request.get(`/api/notebooks/${id}/messages`);
        expect(response.status()).toBe(200);
        const data = await response.json();
        const answer = ((data.messages || data) as SavedMessage[]).find(m => m.role === 'assistant' && fact.test(m.content));
        expect(answer).toBeTruthy();
        const raw = answer!.groundedSources ?? answer!.grounded_sources;
        const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { version: number; citations: { citation_id: number; source_id: string; prefetched_content?: string; excerpt?: string }[] };
        expect(envelope.version).toBe(1); expect(Array.isArray(envelope.citations)).toBe(true);
        const linked = envelope.citations.find(c => Number(c.citation_id) === 1);
        expect(linked?.source_id).toBe(uploadedSource.id);
        const excerpt = (linked!.prefetched_content || linked!.excerpt || '').trim();
        expect(excerpt).toMatch(fact);
        const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
        expect(normalize(uploadedSource.content)).toContain(normalize(excerpt));
        (receipt.uploadedWav as Record<string, unknown>).citationSourceId = linked!.source_id;
      }
      receipt.chatCitationRetainsFact = true;
      await tab(page, 'Studio'); receipt.phase = 'generation'; progress();
      let player: Locator;
      let manifestUrl = '';
      let referenceSource = uploadedSource?.content || content;
      let spokenScript = '';
      let referenceProvenance = '';
      let savedPodcast: SavedPodcast | undefined;
      if (kind === 'podcast') {
        await page.getByTestId('btn-generate-podcast').click();
        await page.getByLabel(/Episode Focus/).fill('Explain the Cedar experiment retaining exactly 17 blue trays, three bean seedlings per tray, six hours daily, fourteen days, and the control receiving the same water but no light.');
        await page.getByRole('tab', { name: 'Brief', exact: true }).click();
        if (scenario.id === 'studio-audio-cancel-retry-podcast') {
          receipt.phase = 'active-generation-cancel'; progress();
          const list = async () => {
            const response = await context.request.get(`/api/notebooks/${id}/studio/podcasts`);
            expect(response.status()).toBe(200);
            return ((await response.json()).podcasts as SavedPodcast[]).length;
          };
          expect(await list()).toBe(0); expect(podcastSavePosts).toBe(0);
          const firstScript = page.waitForResponse(isPodcastPlanResponse, { timeout: 150_000 });
          await page.getByTestId('btn-start-production').click();
          await actualPodcastPlan(await firstScript);
          const active = page.getByTestId('podcast-generating-card');
          await expect(active).toBeVisible();
          const events = () => page.evaluate(() => (globalThis as typeof globalThis & { __studyPodAudioWorkerEvents?: { event: string }[] }).__studyPodAudioWorkerEvents || []);
          await expect.poll(async () => (await events()).some(event => event.event === 'request-synthesize'), { timeout: 180_000 }).toBe(true);
          const synthesisObservedAt = Date.now();
          expect((await events()).some(event => event.event === 'response-audio'), 'Cancel must interrupt native synthesis before the first segment completes').toBe(false);
          await expect(active).toBeVisible();
          const cancelClickedAt = Date.now();
          await active.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect.poll(async () => (await events()).some(event => event.event === 'request-cancel')).toBe(true);
          await expect(active).toBeHidden();
          await expect(page.locator('.podcast-player-container')).toHaveCount(0);
          expect(await list()).toBe(0); expect(podcastSavePosts).toBe(0);
          // Capture after the actual native Cancel dispatch. Sequence order, not rounded elapsed time,
          // rejects a completed segment arriving during the awaited visibility/click gap.
          const cancelTransportEvents = (await events()).map(event => event.event);
          const cancelBeforeCompletedSegment = cancelTransportEvidenceValid(cancelTransportEvents);
          expect(cancelBeforeCompletedSegment, 'Native Cancel must precede every completed audio segment in the first attempt').toBe(true);
          receipt.cancelRetry = { nativeSynthesisSeen: true, activeUICancel: true, nativeCancelSeen: true, cancelBeforeCompletedSegment, cancelTransportEvents,
            savedBeforeCancel: 0, savedAfterCancel: 0, savePostsBeforeCancel: 0, savePostsAfterCancel: 0, synthesisObservedAt, cancelClickedAt };
          progress();
          // Retry through the same user-facing form; do not inject a worker response or provider failure.
          if (!(await page.getByTestId('btn-start-production').isVisible())) await page.getByTestId('btn-generate-podcast').click();
          await page.getByLabel(/Episode Focus/).fill('Explain the Cedar experiment retaining exactly 17 blue trays, three bean seedlings per tray, six hours daily, fourteen days, and the control receiving the same water but no light.');
          await page.getByRole('tab', { name: 'Brief', exact: true }).click();
        }
        const scriptResponse = page.waitForResponse(isPodcastPlanResponse, { timeout: 150_000 });
        if (receipt.cancelRetry) (receipt.cancelRetry as Record<string, unknown>).retryClickedAt = Date.now();
        await page.getByTestId('btn-start-production').click();
        const generated = await scriptResponse; expect(generated.ok()).toBe(true);
        if (receipt.cancelRetry) (receipt.cancelRetry as Record<string, unknown>).retryUIStarted = true;
        const plan = await actualPodcastPlan(generated);
        receipt.podcastEvidencePlan = { passageIds: plan.passageIds, requestPassagesValidated: true };
        player = page.locator('.podcast-player-container');
        // Bound synthesis before a saved script exists. This is only a timeout allowance,
        // never fabricated narration or evidence that compilation/audio succeeded.
        const budget = podcastGenerationBudget(2 + 3 * plan.passageIds.length);
        const generationStartedAt = Date.now();
        receipt.generationBudget = { ...budget, elapsedMs: 0, playerVisible: false };
        progress();
        try {
          const saveFailure = page.getByRole('alert').filter({ hasText: 'Episode needs saving' });
          await expect(player.or(saveFailure).first()).toBeVisible({ timeout: budget.timeoutMs });
          await expect(saveFailure, 'Generated podcast must receive a successful durable save acknowledgment').toHaveCount(0);
          await expect(player).toBeVisible();
          receipt.generationBudget = { ...budget, elapsedMs: Date.now() - generationStartedAt, playerVisible: true };
        } finally {
          receipt.generationBudget = { ...(receipt.generationBudget as ReturnType<typeof podcastGenerationBudget> & { playerVisible: boolean }), elapsedMs: Date.now() - generationStartedAt };
          progress();
        }
        const savedResponse = await context.request.get(`/api/notebooks/${id}/studio/podcasts`);
        expect(savedResponse.status()).toBe(200);
        const savedRecords = (await savedResponse.json()).podcasts as SavedPodcast[];
        expect(savedRecords).toHaveLength(1);
        savedPodcast = savedRecords[0];
        expect(savedPodcast.notebook_id).toBe(id);
        expect(savedPodcast.persistence).toBe('account');
        expect(savedPodcast.script.metadata?.narrationMode).toBe('guided-source');
        expect(savedPodcast.script.metadata?.evidencePassageIds).toEqual(plan.selectedPassages.map(passage => passage.id));
        const script = podcastScript(savedPodcast.script);
        // Inspect actual compiled durable output; do not recompile a provider plan as an oracle.
        for (const passage of plan.selectedPassages) {
          expect(script.segments.some(segment => segment.text === passage.text), 'Selected source passage must survive verbatim in the persisted narration').toBe(true);
        }
        spokenScript = script.spoken;
        referenceProvenance = 'owner-verified account-persisted compiled script, production segment text cleanup; actual provider passageIds validated against actual request';
        writeFileSync(resolve(directory, 'podcast-segments.json'), JSON.stringify(script.segments, null, 2));
        // Require the actual positive result for this generated player. The
        // production validator still fails closed before durable publication.
        await expect(player.locator('.podcast-validation-ok .validation-text')).toHaveText(/^Audio signal detected \(\d+s, [\d.]+kHz\)$/);
        await expect(player.locator('.podcast-validation-warning')).toHaveCount(0);
      } else {
        const capabilitiesResponse = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/api/audiobook/voices'), { timeout: 30_000 });
        await page.getByTestId('audiobook-studio-card').click();
        await expect(page.getByTestId('audiobook-workspace')).toBeVisible();
        const capabilitiesResult = await capabilitiesResponse;
        receipt.audiobookCapabilitiesStatus = capabilitiesResult.status();
        expect(capabilitiesResult.ok()).toBe(true);
        const availability = (await capabilitiesResult.json()) as { capabilities?: { enabled?: boolean; fullGeneration?: boolean; localBeta?: boolean } };
        receipt.audiobookCapabilities = { enabled: availability.capabilities?.enabled === true, fullGeneration: availability.capabilities?.fullGeneration === true, localBeta: availability.capabilities?.localBeta === true };
        progress();
        expect(availability.capabilities?.enabled, 'Actual local audiobook capability must be enabled').toBe(true);
        expect(availability.capabilities?.fullGeneration, 'Actual local runtime must support full generation').toBe(true);
        await expect(page.getByTestId('audiobook-local-beta')).toBeHidden();
        await expect(page.getByTestId('audiobook-book-upload')).toBeAttached();
        const extract = page.waitForResponse(r => r.url().endsWith('/audiobook/extract') && r.request().method() === 'POST');
        await page.getByTestId('audiobook-book-upload').setInputFiles(resolve(process.env.STUDYPOD_FULL_FIXTURES!, 'cedar.epub'));
        const extraction = await extract; expect(extraction.ok()).toBe(true);
        const extracted = await extraction.json(); expect(extracted.content).toMatch(fact);
        receipt.importedSyntheticText = extracted.content; referenceSource = extracted.content;
        const generation = page.waitForRequest(r => r.url().endsWith('/audiobook/generate-full') && r.method() === 'POST');
        await page.getByTestId('audiobook-create-full').click();
        const payload = (await generation).postDataJSON(); expect(payload.provider).toBe('kokoro');
        receipt.provider = payload.provider;
        const manifestResponse = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/playback-manifest') && r.ok());
        const completedJob = page.getByTestId('audiobook-job-complete');
        const stoppedJob = page.getByRole('heading', { name: 'Audiobook creation stopped', exact: true });
        await expect(completedJob.or(stoppedJob).first()).toBeVisible({ timeout: 150_000 });
        expect(await stoppedJob.count(), 'Audiobook generation must finish without a visible failure').toBe(0);
        await expect(completedJob).toBeVisible();
        const busiestSecond = Math.max(0, ...jobPollTimes.map(start => jobPollTimes.filter(time => time >= start && time < start + 1000).length));
        receipt.maximumJobPollsPerSecond = busiestSecond;
        expect(busiestSecond, 'Status updates must not trigger a rapid polling loop').toBeLessThanOrEqual(3);
        player = page.getByTestId('audiobook-chapter-player');
        manifestUrl = (await manifestResponse).url();
        const playbackManifest = await manifestRecord(context, manifestUrl);
        expect(basename(playbackManifest.fileName)).toBe(playbackManifest.fileName);
        expect(playbackManifest.fileName).toMatch(/^[A-Za-z0-9._-]+$/);
        const privatePath = resolve(process.env.AUDIOBOOK_STORAGE_DIR || 'uploads', 'audiobook_manifests', `${playbackManifest.fileName.replace(/\.[^.]+$/, '')}.manifest.json`);
        const privateManifest = JSON.parse(readFileSync(privatePath, 'utf8')) as PrivateManifest;
        expect(privateManifest.ownerId).toBe(profile.user.id); expect(privateManifest.fileName).toBe(playbackManifest.fileName);
        const render = privateManifest.renders[playbackManifest.renderId]; expect(render).toBeTruthy();
        spokenScript = privateManifest.chapters.filter(chapter => render.chapters[String(chapter.id)]?.status === 'completed').map(chapter => chapter.narrationText || chapter.text || '').join('\n\n');
        expect(spokenScript.trim()).toBeTruthy(); referenceProvenance = 'owner-verified private manifest, completed render chapters in source order; narration preparation may transform phrasing';
      }
      receipt.phase = 'playback'; progress(); receipt.media = await playback(player);
      receipt.phase = 'download'; progress();
      const downloadEvent = page.waitForEvent('download');
      if (kind === 'podcast') {
        await player.getByRole('button', { name: / audio options$/ }).click();
        await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
      } else await page.getByRole('button', { name: /^Download full / }).click();
      const download = await downloadEvent; expect(await download.failure()).toBeNull();
      const output = resolve(directory, 'generated-audio.bin'); await download.saveAs(output);
      const bytes = readFileSync(output); expect(bytes.byteLength).toBeGreaterThan(1000);
      const transferChunkBytes = 65_536;
      const transfer = { byteLength: bytes.byteLength, sha256: sha256(bytes),
        chunks: Array.from({ length: Math.ceil(bytes.byteLength / transferChunkBytes) },
          (_, index) => bytes.subarray(index * transferChunkBytes, (index + 1) * transferChunkBytes).toString('base64')) };
      receipt.phase = 'downloaded-signal-transfer';
      receipt.downloadSignalTransfer = { byteLength: transfer.byteLength, chunks: transfer.chunks.length, transport: 'chunked-base64', completed: false }; progress();
      const transferStarted = Date.now();
      const signal = await page.evaluate(async (transfer: { byteLength: number; sha256: string; chunks: string[] }) => {
        const reconstructionStarted = performance.now();
        // BEGIN exact-byte reconstruction: offline controls extract this same code.
        const chunkBytes = 65_536;
        if (!Number.isSafeInteger(transfer.byteLength) || transfer.byteLength <= 0
          || !/^[a-f0-9]{64}$/.test(transfer.sha256) || !Array.isArray(transfer.chunks)
          || transfer.chunks.length !== Math.ceil(transfer.byteLength / chunkBytes)) throw new Error('DownloadedTransferInvalidShape');
        const data = new Uint8Array(transfer.byteLength);
        for (let index = 0; index < transfer.chunks.length; index++) {
          const encoded = transfer.chunks[index];
          if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(chunkBytes / 3)) throw new Error('DownloadedTransferInvalidChunk');
          let binary: string;
          try { binary = atob(encoded); } catch { throw new Error('DownloadedTransferInvalidBase64'); }
          const offset = index * chunkBytes;
          if (binary.length !== Math.min(chunkBytes, transfer.byteLength - offset)) throw new Error('DownloadedTransferLengthMismatch');
          for (let i = 0; i < binary.length; i++) data[offset + i] = binary.charCodeAt(i);
        }
        const digest = await crypto.subtle.digest('SHA-256', data.buffer);
        const reconstructedSha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (reconstructedSha !== transfer.sha256) throw new Error('DownloadedTransferHashMismatch');
        // END exact-byte reconstruction.
        const reconstructionMs = performance.now() - reconstructionStarted;
        const decoder = new AudioContext();
        try {
          const decodeStarted = performance.now();
          const reconstructedByteLength = data.byteLength;
          const decoded = await decoder.decodeAudioData(data.buffer);
          const decodeMs = performance.now() - decodeStarted, scanStarted = performance.now();
          let peak = 0, sum = 0, count = 0;
          for (let c = 0; c < decoded.numberOfChannels; c++) for (const value of decoded.getChannelData(c)) {
            if (!Number.isFinite(value)) throw new Error('Non-finite downloaded PCM');
            peak = Math.max(peak, Math.abs(value)); sum += value * value; count++;
          }
          return { duration: decoded.duration, peak, rms: Math.sqrt(sum / count),
            transfer: { reconstructedSha, byteLength: reconstructedByteLength, chunks: transfer.chunks.length,
              reconstructionMs, decodeMs, scanMs: performance.now() - scanStarted } };
        } finally { await decoder.close(); }
      }, transfer);
      receipt.downloadSignalTransfer = { transport: 'chunked-base64', completed: true, elapsedMs: Date.now() - transferStarted, ...signal.transfer }; progress();
      expect(signal.duration).toBeGreaterThan(3); expect(signal.rms).toBeGreaterThan(0.0005);
      receipt.download = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), signal };
      writeFileSync(resolve(directory, 'source.txt'), referenceSource);
      writeFileSync(resolve(directory, 'spoken-script.txt'), spokenScript);
      const fidelityManifestPath = resolve(directory, 'fidelity-manifest.json');
      writeFileSync(fidelityManifestPath, JSON.stringify({ kind, syntheticReference: true, audioPath: 'generated-audio.bin', audioSha256: sha256(bytes), sourcePath: 'source.txt', scriptPath: 'spoken-script.txt', sourceSha256: sha256(referenceSource), scriptSha256: sha256(spokenScript), generationReceipt: 'receipt.json', facts, suggestedFilename: download.suggestedFilename(), referenceProvenance }, null, 2));
      receipt.fidelityManifest = fidelityManifestPath;
      receipt.phase = 'saved-listening-state'; progress();
      if (kind === 'podcast') {
        const podcastUrl = `/api/notebooks/${id}/studio/podcasts`;
        await expect.poll(async () => {
          const response = await context.request.get(podcastUrl);
          expect(response.status()).toBe(200);
          const records = (await response.json()).podcasts as SavedPodcast[];
          savedPodcast = records[0];
          return records.length;
        }, { timeout: 30_000, message: 'Generated podcast must be saved to its owning account' }).toBe(1);
        if (receipt.cancelRetry) {
          expect(podcastSavePosts, 'Only the retry may publish a saved episode').toBe(1);
          expect(receipt.podcastSaveStatus).toBe(201);
          Object.assign(receipt.cancelRetry, { savedAfterRetry: 1, savePostsAfterRetry: podcastSavePosts });
          receipt.cancelRetryVerified = true; progress();
        }
        if (!savedPodcast) throw new Error('Account podcast missing');
        expect(savedPodcast.notebook_id).toBe(id);
        expect(savedPodcast.persistence).toBe('account');
        expect(savedPodcast.audio_sha256).toBe(sha256(bytes));
        expect(savedPodcast.byte_length).toBe(bytes.length);
        expect(savedPodcast.script.segments).toEqual(JSON.parse(readFileSync(resolve(directory, 'podcast-segments.json'), 'utf8')));
        const sourcesResponse = await context.request.get(`/api/notebooks/${id}/sources`);
        expect(sourcesResponse.status()).toBe(200);
        const sourceData = await sourcesResponse.json();
        expect(savedPodcast.source_ids).toEqual((sourceData.sources || sourceData).map((source: SavedSource) => source.id));
        if (uploadedSource) {
          expect(savedPodcast.source_ids).toEqual([uploadedSource.id]);
          (receipt.uploadedWav as Record<string, unknown>).podcastSourceIds = savedPodcast.source_ids;
          (receipt.uploadedWav as Record<string, unknown>).fidelitySourceSha256 = sha256(Buffer.from(referenceSource));
          receipt.uploadedWavVerified = true;
        }
        const recordResponse = await context.request.get(`${podcastUrl}/${savedPodcast.id}`);
        expect(recordResponse.status()).toBe(200);
        expect((await recordResponse.json()).podcast).toEqual(savedPodcast);
        // Verify the account copy through the same bounded cloud transport as the player.
        const chunkSize = 1024 * 1024;
        expect(savedPodcast.byte_length).toBe(bytes.length);
        expect(savedPodcast.audio_sha256).toBe(sha256(bytes));
        const accountChunks: Buffer[] = [];
        for (let index = 0; index < Math.ceil(bytes.length / chunkSize); index++) {
          const audioResponse = await context.request.get(`${podcastUrl}/${savedPodcast.id}/audio/chunks/${index}`, { timeout: 15_000 });
          expect(audioResponse.status()).toBe(200);
          const chunk = await audioResponse.body();
          expect(chunk.length).toBe(Math.min(chunkSize, bytes.length - index * chunkSize));
          accountChunks.push(chunk);
        }
        expect(sha256(Buffer.concat(accountChunks))).toBe(sha256(bytes));
        const position = await seekCheckpoint(player);
        await expect.poll(() => page.evaluate(() => {
          return Object.keys(localStorage).filter(key => key.startsWith('studypod:playback:'))
            .map(key => { try { return JSON.parse(localStorage.getItem(key)!); } catch { return null; } })
            .find(value => value?.kind === 'podcast' && value.currentTime >= 3 && value.duration - value.currentTime > 5) || null;
        })).not.toBeNull();
        // Read only the audio checkpoint namespace; never enumerate auth storage values.
        const saved = await page.evaluate(() => Object.keys(localStorage)
          .filter(key => key.startsWith('studypod:playback:'))
          .map(key => { try { return JSON.parse(localStorage.getItem(key)!); } catch { return null; } })
          .find(value => value?.kind === 'podcast' && value.currentTime >= 3 && value.duration - value.currentTime > 5));
        expect(saved.currentTime).toBeCloseTo(position, 0);
        // Real saved metadata, actual playback checkpoint, and exact owned episode route.
        const recent = await context.request.get('/api/notebooks/studio/podcasts/recent');
        expect(recent.status()).toBe(200);
        expect((await recent.json()).podcast.id).toBe(savedPodcast.id);
        // First-source enrichment may rename the notebook after its initial owner receipt.
        const currentNotebookResponse = await context.request.get(`/api/notebooks/${id}`);
        expect(currentNotebookResponse.status()).toBe(200);
        const currentNotebook = await currentNotebookResponse.json();
        expect(currentNotebook.id).toBe(id);
        expect(currentNotebook.userId).toBe(profile.user.id);
        expect(typeof currentNotebook.title).toBe('string');
        expect(currentNotebook.title.trim().length).toBeGreaterThan(0);
        const currentNotebookTitle = currentNotebook.title as string;
        const exactEpisodeHref = `/notebook/${encodeURIComponent(id!)}?view=studio&episode=${encodeURIComponent(savedPodcast.id)}`;
        receipt.dashboardNotebookIdentity = { id, ownerVerified: true, initialTitle: notebookTitle, currentTitle: currentNotebookTitle, titleChanged: notebookTitle !== currentNotebookTitle };
        progress();
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Continue listening', exact: true })).toBeVisible();
        const cue = page.getByRole('link', { name: `Resume ${savedPodcast.title} in ${currentNotebookTitle}`, exact: true });
        await expect(cue).toBeVisible();
        await expect(cue).toHaveAttribute('href', exactEpisodeHref);
        await expect(cue).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        for (let i = 0; i < 60 && !(await cue.evaluate(node => node === document.activeElement)); i++) await page.keyboard.press('Tab');
        await expect(cue).toBeFocused();
        await cue.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/notebook/${id}\\?view=studio&episode=${savedPodcast.id}`));
        await tab(page, 'Studio');
        player = page.locator('.podcast-player-container');
        await expect.poll(() => player.locator('audio').evaluate((node: HTMLAudioElement, target: number) =>
          node.readyState >= 2 && node.paused && Math.abs(node.currentTime - target) < 2, saved.currentTime)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        receipt.dashboardCue = { realRecentMetadata: true, realCheckpoint: true, exactEpisode: true, pausedAtCheckpoint: true, keyboardAction: true, noHorizontalOverflow: true, dashboardNoHorizontalOverflow: true };
        progress();
        await reopenAudio(page, kind);
        // Reload restores the player; saved history remains below that player.
        await expect(page.locator('.studypod-listen-history').getByRole('button', { name: /^Resume .+ at / })).toBeVisible();
        await page.getByRole('button', { name: /^Resume .+ at / }).click();
        player = page.locator('.podcast-player-container');
        await expect.poll(() => player.locator('audio').evaluate((node: HTMLAudioElement, target: number) =>
          node.readyState >= 2 && Math.abs(node.currentTime - target) < 2, saved.currentTime)).toBe(true);
        receipt.persistence = { browserHistoryReopened: true, checkpoint: { kind: saved.kind, position: saved.currentTime }, serverPodcastRecord: true, record: savedPodcast };
        progress();
        const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', viewport: page.viewportSize() || undefined, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, serviceWorkers: 'block' });
        try {
          const freshPage = await fresh.newPage();
          await freshPage.goto('/auth?mode=cloud-login');
          await freshPage.getByLabel('Email Address').fill(email);
          await freshPage.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
          const signedIn = freshPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/auth/signin'));
          await freshPage.getByRole('button', { name: 'Sign in', exact: true }).click();
          expect((await signedIn).status()).toBe(200);
          await expect.poll(async () => { const response = await fresh.request.get('/api/user/profile'); return response.ok() ? (await response.json()).user.email : null; }).toBe(email);
          // Verify the same notebook owner and its current title after fresh authentication.
          const freshNotebookResponse = await fresh.request.get(`/api/notebooks/${id}`);
          expect(freshNotebookResponse.status()).toBe(200);
          const freshNotebook = await freshNotebookResponse.json();
          expect(freshNotebook.id).toBe(id);
          expect(freshNotebook.userId).toBe(profile.user.id);
          expect(typeof freshNotebook.title).toBe('string');
          expect(freshNotebook.title.trim().length).toBeGreaterThan(0);
          const freshNotebookTitle = freshNotebook.title as string;
          receipt.freshDashboardNotebookIdentity = { id, ownerVerified: true, initialTitle: notebookTitle, currentTitle: freshNotebookTitle, titleChanged: notebookTitle !== freshNotebookTitle };
          progress();
          // A fresh browser has server-saved audio but no device playback checkpoint.
          await freshPage.goto('/');
          await expect(freshPage.getByRole('heading', { name: 'Saved audio', exact: true })).toBeVisible();
          const freshCue = freshPage.getByRole('link', { name: `Open ${savedPodcast.title} in ${freshNotebookTitle}`, exact: true });
          await expect(freshCue).toBeVisible();
          await expect(freshCue).toHaveAttribute('href', exactEpisodeHref);
          await freshCue.click();
          await expect(freshPage).toHaveURL(new RegExp(`/notebook/${id}\\?view=studio&episode=${savedPodcast.id}`));
          await tab(freshPage, 'Studio');
          await expect.poll(() => freshPage.locator('.podcast-player-container audio').evaluate((node: HTMLAudioElement) =>
            node.readyState >= 2 && node.paused)).toBe(true);
          await freshPage.goto(`/notebook/${id}`);
          await tab(freshPage, 'Studio');
          await expect(freshPage.getByRole('heading', { name: 'Saved audio overviews', exact: true })).toBeVisible();
          await freshPage.getByRole('button', { name: `Play ${savedPodcast.title}`, exact: true }).click();
          const freshPlayer = freshPage.locator('.podcast-player-container');
          const freshMedia = await playback(freshPlayer);
          const freshPosition = await seekCheckpoint(freshPlayer);
          if ((freshPage.viewportSize()?.width ?? 1280) <= 390) {
            expect([320, 390]).toContain(freshPage.viewportSize()?.width);
            // Real owner login and server-saved episode above are prerequisites.
            receipt.mobileRemountOracleVersion = 'mobile-podcast-tab-remount-v2';
            const tabRemounts: Record<string, unknown>[] = [];
            receipt.mobileSavedPodcastTabRemounts = tabRemounts;
            const checkpointKey = 'studypod:playback:' + encodeURIComponent(savedPodcast.id.trim());
            for (const destination of ['Chat', 'Sources']) {
              receipt.phase = 'fresh-owner-podcast-tab-' + destination.toLowerCase(); progress();
              const tabReceipt: Record<string, unknown> = { destination, width: freshPage.viewportSize()?.width, savedEpisodeVerified: true, savedMediaId: savedPodcast.id, passed: false };
              tabRemounts.push(tabReceipt); progress();
              const native = freshPlayer.locator('audio');
              const held = await native.evaluateHandle((node: HTMLAudioElement) => node);
              if (!held) throw new Error('SavedPodcastNativeElementMissing');
              try {
                const actionStartedAt = await freshPage.evaluate(() => Date.now());
                const startedAt = await held.evaluate(node => node.currentTime);
                await freshPlayer.getByRole('button', { name: 'Play', exact: true }).click();
                await expect.poll(() => held.evaluate((node, start) => !node.paused && node.currentTime > start + 0.2, startedAt)).toBe(true);
                const token = await holdPlayingNativeAudio(held, startedAt);
                const beforeExit = await held.evaluate(node => ({ exitTime: node.currentTime, duration: node.duration, playbackRate: node.playbackRate }));
                expect(beforeExit.exitTime).toBeGreaterThan(startedAt + 0.2);
                await tab(freshPage, destination);
                await expect(freshPlayer).toHaveCount(0);
                const disposal = await observeHeldNativeDisposal(held, token);
                tabReceipt.disposal = disposal;
                tabReceipt.disposalPassed = nativeDisposalEvidencePassed(disposal); progress();
                expect(nativeDisposalEvidencePassed(disposal), 'Leaving Studio must stop and release the held playing media').toBe(true);
                const checkpoint = await freshPage.evaluate(key => {
                  const raw = localStorage.getItem(key);
                  if (!raw) return null;
                  const value = JSON.parse(raw);
                  return { mediaId: value.mediaId, kind: value.kind, currentTime: value.currentTime,
                    duration: value.duration, playbackRate: value.playbackRate, updatedAt: value.updatedAt };
                }, checkpointKey);
                const checkpointObservedAt = await freshPage.evaluate(() => Date.now());
                tabReceipt.bounds = { prePlayTime: startedAt, ...beforeExit, actionStartedAt, checkpointObservedAt };
                tabReceipt.checkpoint = checkpoint; progress();
                expect(checkpoint?.mediaId).toBe(savedPodcast.id);
                expect(checkpoint?.kind).toBe('podcast');
                expect(Number.isFinite(checkpoint?.currentTime)).toBe(true);
                expect(checkpoint!.currentTime).toBeGreaterThan(startedAt + 0.15);
                expect(checkpoint!.currentTime).toBeGreaterThanOrEqual(beforeExit.exitTime - 0.05);
                expect(Number.isFinite(checkpoint!.duration)).toBe(true);
                expect(Number.isFinite(checkpoint!.playbackRate)).toBe(true);
                expect(Math.abs(checkpoint!.duration - beforeExit.duration)).toBeLessThanOrEqual(0.05);
                expect(checkpoint!.playbackRate).toBe(beforeExit.playbackRate);
                expect(checkpoint!.currentTime).toBeGreaterThanOrEqual(3);
                expect(checkpoint!.duration - checkpoint!.currentTime).toBeGreaterThan(5);
                expect(Number.isFinite(Date.parse(checkpoint!.updatedAt))).toBe(true);
                expect(Date.parse(checkpoint!.updatedAt)).toBeGreaterThanOrEqual(actionStartedAt);
                expect(Date.parse(checkpoint!.updatedAt)).toBeLessThanOrEqual(checkpointObservedAt);
                await tab(freshPage, 'Studio');
                await expect(freshPlayer).toBeVisible();
                await expect.poll(() => native.evaluate((node: HTMLAudioElement) =>
                  node.readyState >= 2 && node.duration > 12 && !node.error && node.paused)).toBe(true);
                await expect.poll(() => native.evaluate((node: HTMLAudioElement) => node.currentTime),
                  { message: 'Remounted saved episode must restore the exact device checkpoint' }).toBeCloseTo(checkpoint!.currentTime, 1);
                const restored = await native.evaluate(async (node: HTMLAudioElement) => {
                  const bytes = await (await fetch(node.currentSrc)).arrayBuffer();
                  const digest = await crypto.subtle.digest('SHA-256', bytes);
                  const initialTime = node.currentTime, started = performance.now();
                  do { await new Promise<void>(resolve => setTimeout(resolve, 25)); } while (performance.now() - started < 250);
                  return { sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
                    paused: node.paused, timeBefore: initialTime, timeAfter: node.currentTime,
                    elapsedMs: performance.now() - started, playbackRate: node.playbackRate, duration: node.duration, readyState: node.readyState };
                });
                tabReceipt.restored = restored; progress();
                expect(restored.sha256, 'Remount must load the actual owned saved episode bytes').toBe(sha256(bytes));
                expect(restored.paused, 'Restored audio must wait for the user to press Play').toBe(true);
                expect(restored.elapsedMs).toBeGreaterThanOrEqual(250);
                expect(Math.abs(restored.timeAfter - restored.timeBefore)).toBeLessThanOrEqual(0.001);
                expect(restored.playbackRate).toBe(checkpoint!.playbackRate);
                expect(restored.readyState).toBeGreaterThanOrEqual(2);
                expect(Number.isFinite(restored.duration)).toBe(true);
                expect(Math.abs(restored.duration - checkpoint!.duration)).toBeLessThanOrEqual(0.05);
                await freshPlayer.getByRole('button', { name: 'Play', exact: true }).click();
                await expect.poll(() => native.evaluate((node: HTMLAudioElement, resumeTime: number) =>
                  !node.paused && node.currentTime > resumeTime + 0.2, restored.timeAfter)).toBe(true);
                await freshPlayer.getByRole('button', { name: 'Pause', exact: true }).click();
                const replay = await native.evaluate((node: HTMLAudioElement) => ({ paused: node.paused, currentTime: node.currentTime, playbackRate: node.playbackRate, duration: node.duration, readyState: node.readyState }));
                expect(replay.paused).toBe(true);
                expect(Number.isFinite(replay.currentTime)).toBe(true);
                expect(replay.currentTime).toBeGreaterThan(restored.timeAfter + 0.2);
                expect(replay.playbackRate).toBe(checkpoint!.playbackRate);
                expect(Number.isFinite(replay.duration)).toBe(true);
                expect(Math.abs(replay.duration - checkpoint!.duration)).toBeLessThanOrEqual(0.05);
                expect(replay.readyState).toBeGreaterThanOrEqual(2);
                tabReceipt.replay = replay; progress();
                const reseekPosition = await seekCheckpoint(freshPlayer);
                Object.assign(tabReceipt, { replayAdvanced: true, reseekPosition, passed: true });
                progress();
              } finally { await held.dispose(); }
            }
            expect(tabRemounts).toHaveLength(2);
            expect(tabRemounts.map(row => row.destination)).toEqual(['Chat', 'Sources']);
            expect(tabRemounts.every(row => row.passed === true)).toBe(true);
            receipt.phase = 'fresh-owner-podcast-download'; progress();
          }

          const freshDownload = freshPage.waitForEvent('download');
          await freshPlayer.getByRole('button', { name: / audio options$/ }).click();
          await freshPage.getByRole('menuitem', { name: 'Download', exact: true }).click();
          const downloaded = await freshDownload;
          expect(await downloaded.failure()).toBeNull();
          const freshOutput = resolve(directory, 'fresh-owner-podcast.wav');
          await downloaded.saveAs(freshOutput);
          expect(sha256(readFileSync(freshOutput))).toBe(sha256(bytes));
          receipt.freshOwnerPodcast = { signedIn: true, emptyBrowserHistory: true, media: freshMedia, seekPosition: freshPosition, downloadMatches: true };
        } finally { await fresh.close(); }
      } else {
        let manifest = await manifestRecord(context, manifestUrl);
        const ready = manifest.chapters.filter((chapter: PlaybackManifest['chapters'][number]) => chapter.narratable !== false && chapter.audioUrl);
        expect(ready.length).toBeGreaterThan(0);
        await player.locator('summary').filter({ hasText: /^Chapters$/ }).click();
        const chapters = player.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Chapters$/ }) });
        await chapters.locator('button:enabled').nth(ready.length > 1 ? 1 : 0).click();
        const chapterId = ready[ready.length > 1 ? 1 : 0].id;
        await expect.poll(() => player.locator('audio').evaluate((node: HTMLAudioElement) => node.readyState >= 2)).toBe(true);
        await player.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
        const position = await seekCheckpoint(player);
        const bookmarkResponse = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/bookmarks') && r.request().method() === 'POST');
        await player.getByRole('button', { name: /^Bookmark \d/ }).click();
        expect((await bookmarkResponse).ok()).toBe(true);
        await expect.poll(async () => {
          manifest = await manifestRecord(context, manifestUrl);
          return manifest.listenerState.currentChapterId === chapterId && manifest.listenerState.playbackRate === 1.5
            && Math.abs(manifest.listenerState.currentTimeSeconds - position) < 1
            && manifest.bookmarks.some((b: PlaybackManifest['bookmarks'][number]) => b.chapterId === chapterId && Math.abs(b.timeSeconds - position) < 1);
        }).toBe(true);
        const bookmark = manifest.bookmarks.find((b: PlaybackManifest['bookmarks'][number]) => b.chapterId === chapterId && Math.abs(b.timeSeconds - position) < 1);
        if (!bookmark) throw new Error('Saved owner bookmark missing');
        await reopenAudio(page, kind);
        player = page.getByTestId('audiobook-chapter-player');
        await expect(player.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5');
        await expect.poll(() => player.locator('audio').evaluate((node: HTMLAudioElement, target: number) =>
          node.readyState >= 2 && Math.abs(node.currentTime - target) < 1, position)).toBe(true);
        await player.locator('summary').filter({ hasText: /^Bookmarks \(/ }).click();
        const bookmarks = player.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Bookmarks \(/ }) });
        await bookmarks.getByRole('button').filter({ hasText: bookmark.label }).click();
        await expect.poll(() => player.locator('audio').evaluate((node: HTMLAudioElement, target: number) =>
          !node.paused && Math.abs(node.currentTime - target) < 2, bookmark.timeSeconds)).toBe(true);
        await player.getByRole('button', { name: 'Pause', exact: true }).click();
        receipt.phase = 'fresh-owner-audiobook'; progress();
        const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', viewport: page.viewportSize() || undefined, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, serviceWorkers: 'block' });
        try {
          const freshPage = await fresh.newPage();
          await freshPage.goto('/auth?mode=cloud-login');
          await freshPage.getByLabel('Email Address').fill(email);
          await freshPage.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
          const signedIn = freshPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/auth/signin'));
          await freshPage.getByRole('button', { name: 'Sign in', exact: true }).click();
          expect((await signedIn).status()).toBe(200);
          await expect.poll(async () => { const response = await fresh.request.get('/api/user/profile'); return response.ok() ? (await response.json()).user.email : null; }).toBe(email);
          await freshPage.goto(`/notebook/${id}`);
          await tab(freshPage, 'Studio');
          await freshPage.getByTestId('audiobook-studio-card').click();
          const freshPlayer = freshPage.getByTestId('audiobook-chapter-player');
          await expect(freshPage.getByTestId('audiobook-saved-render')).toBeVisible();
          await expect(freshPage.getByTestId('audiobook-create-full')).toHaveCount(0);
          await expect(freshPlayer.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5');
          await expect.poll(() => freshPlayer.locator('audio').evaluate((node: HTMLAudioElement, target: number) => node.readyState >= 2 && Math.abs(node.currentTime - target) < 2, position)).toBe(true);
          const restored = await manifestRecord(fresh, manifestUrl);
          expect(restored.renderId).toBe(manifest.renderId);
          expect(restored.listenerState.currentChapterId).toBe(chapterId);
          const expectedChapter = restored.chapters.find(chapter => chapter.id === chapterId);
          if (!expectedChapter) throw new Error('Restored chapter missing from owned manifest');
          const restoredMedia = await assertLoadedChapter(freshPlayer, fresh, expectedChapter, 1.5);
          await freshPlayer.locator('summary').filter({ hasText: /^Bookmarks \(/ }).click();
          await freshPlayer.locator('details').filter({ has: freshPage.locator('summary').filter({ hasText: /^Bookmarks \(/ }) }).getByRole('button').filter({ hasText: bookmark.label }).click();
          await expect.poll(() => freshPlayer.locator('audio').evaluate((node: HTMLAudioElement, target: number) => !node.paused && Math.abs(node.currentTime - target) < 2, bookmark.timeSeconds)).toBe(true);
          await freshPlayer.getByRole('button', { name: 'Pause', exact: true }).click();
          await freshPlayer.locator('summary').filter({ hasText: /^Chapters$/ }).click();
          await freshPlayer.locator('details').filter({ has: freshPage.locator('summary').filter({ hasText: /^Chapters$/ }) }).locator('button:enabled').first().click();
          let mobileContinuity: Record<string, unknown> | undefined;
          if ((freshPage.viewportSize()?.width || 0) < 1100) {
            const starting = await manifestRecord(fresh, manifestUrl);
            const playingChapter = starting.chapters.find(chapter => chapter.id === ready[0].id);
            if (!playingChapter) throw new Error('First listening chapter missing');
            const listeningMedia = await assertLoadedChapter(freshPlayer, fresh, playingChapter, 1.5);
            // Choosing a ready chapter intentionally starts playback. Prove that
            // native contract before exercising an explicit Pause -> Play round trip.
            await expect.poll(() => freshPlayer.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0.2), { message: 'Selecting the owned ready chapter must start actual playback' }).toBe(true);
            await freshPlayer.getByRole('button', { name: 'Pause', exact: true }).click();
            await expect.poll(() => freshPlayer.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
            await freshPlayer.getByRole('button', { name: 'Play', exact: true }).click();
            await expect.poll(() => freshPlayer.locator('audio').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0.2)).toBe(true);
            await freshPlayer.getByRole('button', { name: 'Ask about this point', exact: true }).click();
            const askedAt = await freshPlayer.locator('audio').evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime }));
            expect(askedAt.paused, 'Ask intentionally pauses listening before switching tabs').toBe(true);
            const chapterLabel = await freshPlayer.locator('form p.truncate').innerText();
            const sourceResponse = await fresh.request.get(`/api/notebooks/${id}/sources`);
            expect(sourceResponse.ok()).toBe(true);
            const sourceData = await sourceResponse.json();
            const groundedSource = (sourceData.sources || sourceData).find((source: SavedSource) => fact.test(source.content || ''));
            if (!groundedSource) throw new Error('Owned grounding source missing');
            const messagesBeforeResponse = await fresh.request.get(`/api/notebooks/${id}/messages`);
            expect(messagesBeforeResponse.ok()).toBe(true);
            const messagesBefore = await messagesBeforeResponse.json();
            const beforeCount = (messagesBefore.messages || messagesBefore).length;
            const question = `Listening check ${randomUUID()}: according to the Cedar source, exactly how many blue trays are used? Cite the source.`;
            await freshPlayer.getByLabel('Question about the current audiobook point').fill(question);
            const chatRequest = freshPage.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/api/notebooks/${id}/chat`));
            const chatResponse = freshPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/api/notebooks/${id}/chat`));
            await freshPlayer.getByRole('button', { name: 'Ask', exact: true }).click();
            const submitted = (await chatRequest).postDataJSON() as { message: string; sourceIds: string[] };
            expect(submitted.sourceIds).toEqual([groundedSource.id]);
            expect(submitted.message).toContain(question);
            expect(submitted.message).toContain(chapterLabel.split(' Page ')[0].replace(/\s+[^A-Za-z0-9]+$/, ''));
            const total = Math.floor(askedAt.time);
            const timestamp = total >= 3600 ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
            expect(submitted.message).toContain(`${timestamp} into the chapter`);
            expect(submitted.message).toContain('ground the answer to the chapter/page range');
            await expect(freshPage.getByRole('tab', { name: /Chat$/ })).toHaveAttribute('aria-selected', 'true');
            expect((await chatResponse).ok()).toBe(true);
            await expect.poll(async () => {
              const response = await fresh.request.get(`/api/notebooks/${id}/messages`);
              expect(response.ok()).toBe(true);
              const body = await response.json();
              return (body.messages || body).slice(beforeCount).some((message: SavedMessage) => message.role === 'assistant' && fact.test(message.content || ''));
            }, { timeout: 65_000, message: 'New listening answer must retain the actual source fact' }).toBe(true);
            const listeningCitation = freshPage.getByRole('button', { name: /^Citation 1/ }).last();
            await expect(listeningCitation).toBeVisible();
            await listeningCitation.click();
            const evidenceId = await listeningCitation.getAttribute('aria-controls');
            expect(evidenceId).toBeTruthy();
            await expect(freshPage.locator(`[id="${evidenceId}"]`)).toContainText(fact);
            await tab(freshPage, 'Studio');
            await freshPage.getByTestId('audiobook-studio-card').click();
            await expect(freshPlayer).toBeVisible();
            const returnedMedia = await assertLoadedChapter(freshPlayer, fresh, playingChapter, 1.5);
            expect(returnedMedia.paused, 'Returning from Ask must not start audio without a Play gesture').toBe(true);
            await expect.poll(() => freshPlayer.locator('audio').evaluate((audio: HTMLAudioElement, target: number) => Math.abs(audio.currentTime - target) < 2, askedAt.time)).toBe(true);
            mobileContinuity = { submittedSourceId: groundedSource.id, requestedAt: askedAt.time, expectedChapterId: listeningMedia.chapterId, expectedChapterSha256: listeningMedia.sha256, groundedNewAnswer: true, citationVerified: true, returnedMedia, resumedPaused: true };
          }
          const media = await playback(freshPlayer);
          const seekPosition = await seekCheckpoint(freshPlayer);
          const freshDownload = freshPage.waitForEvent('download');
          await freshPage.getByRole('button', { name: /^Download full / }).click();
          const downloaded = await freshDownload;
          expect(await downloaded.failure()).toBeNull();
          const output = resolve(directory, 'fresh-owner-audiobook.wav');
          await downloaded.saveAs(output);
          expect(sha256(readFileSync(output))).toBe(sha256(bytes));
          receipt.freshOwnerAudiobook = { signedIn: true, emptyBrowserHistory: true, savedRender: true, chapterRestored: true, speedRestored: true, restoredMedia, mobileContinuity, resumePosition: position, bookmarkReopenedAndJumped: true, media, seekPosition, downloadMatches: true };
        } finally { await fresh.close(); }
        const deletion = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/bookmarks/${bookmark.id}`));
        await bookmarks.getByRole('button', { name: 'Delete bookmark', exact: true }).click();
        expect((await deletion).ok()).toBe(true);
        await expect.poll(async () => (await manifestRecord(context, manifestUrl)).bookmarks.some((b: PlaybackManifest['bookmarks'][number]) => b.id === bookmark.id)).toBe(false);
        await reopenAudio(page, kind);
        await expect(page.getByTestId('audiobook-chapter-player').locator('summary').filter({ hasText: /^Bookmarks \(/ })).toHaveCount(0);
        receipt.persistence = { serverChapterIdMatched: true, speed: 1.5, resumePosition: position, bookmarkReopenedAndJumped: true, bookmarkDeletionPersisted: true, readyChapters: ready.length };
      }
      receipt.phase = 'foreign-account-denial'; progress();
      const foreign = await browser.newContext({ baseURL: 'http://127.0.0.1:4182' });
      try {
        const other = await foreign.newPage(); const identity = randomUUID();
        const email = `audio-foreign-${identity}@studypod.invalid`;
        await other.goto('/auth?mode=cloud-signup');
        await other.getByLabel('Display Name').fill(`Audio foreign ${identity}`);
        await other.getByLabel('Email Address').fill(email);
        await other.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
        await other.locator('#tosAccepted').click();
        await other.getByRole('button', { name: 'Create Account', exact: true }).click();
        await expect.poll(async () => { const response = await foreign.request.get('/api/user/profile'); return response.ok() ? (await response.json()).user.email : null; }).toBe(email);
        const denied = await foreign.request.get(`/api/notebooks/${id}`);
        expect(denied.status()).toBe(404);
        receipt.foreignNotebookDenied = denied.status();
        if (savedPodcast) {
          const foreignRecent = await foreign.request.get('/api/notebooks/studio/podcasts/recent');
          expect(foreignRecent.status()).toBe(200);
          expect((await foreignRecent.json()).podcast).toBeNull();
          // An account without notebooks does not mount the dashboard audio query.
          // Give this account an empty owned notebook so the UI must settle that query.
          const foreignNotebook = await foreign.request.post('/api/notebooks', { data: { title: `Foreign audio boundary ${identity}` } });
          expect(foreignNotebook.status()).toBe(201);
          expect((await foreignNotebook.json()).id).toBeTruthy();
          const foreignUiRecent = other.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/notebooks/studio/podcasts/recent');
          await other.goto('/');
          const foreignUiResponse = await foreignUiRecent;
          expect(foreignUiResponse.status()).toBe(200);
          expect((await foreignUiResponse.json()).podcast).toBeNull();
          await expect(other.getByRole('heading', { name: 'Saved audio', exact: true })).toBeVisible();
          await expect(other.getByText('No saved audio yet. Open a notebook\'s Studio to create an audio overview.', { exact: true })).toBeVisible();
          await expect(other.getByText(savedPodcast.title, { exact: true })).toHaveCount(0);
          await expect(other.getByRole('link', { name: /^(?:Open|Resume) .* in / })).toHaveCount(0);
          receipt.dashboardCueForeignAccountHidden = true;
          receipt.foreignDashboardQuery = { ownedEmptyNotebook: true, uiRecentQuerySettledEmpty: true, foreignTitleAndCueAbsent: true };
          const podcastUrl = `/api/notebooks/${id}/studio/podcasts`;
          const statuses: Record<string, number> = {};
          for (const [name, suffix] of [['list', ''], ['record', `/${savedPodcast.id}`], ['audio', `/${savedPodcast.id}/audio`], ['audioChunk', `/${savedPodcast.id}/audio/chunks/0`]]) {
            statuses[name] = (await foreign.request.get(`${podcastUrl}${suffix}`)).status();
            expect(statuses[name]).toBe(404);
          }
          statuses.delete = (await foreign.request.delete(`${podcastUrl}/${savedPodcast.id}`)).status();
          expect(statuses.delete).toBe(404);
          statuses.create = (await foreign.request.post(podcastUrl, { multipart: { metadata: JSON.stringify({ id: randomUUID(), title: savedPodcast.title, script: savedPodcast.script, sourceIds: savedPodcast.source_ids }), audio: { name: 'synthetic.wav', mimeType: 'audio/wav', buffer: bytes } } })).status();
          expect(statuses.create).toBe(404);
          const unchanged = await context.request.get(`${podcastUrl}/${savedPodcast.id}`);
          expect(unchanged.status()).toBe(200);
          expect((await unchanged.json()).podcast).toEqual(savedPodcast);
          receipt.foreignPodcastDenied = { ...statuses, ownerRecordUnchanged: true };
        }
        if (manifestUrl) {
          const ownerManifest = await manifestRecord(context, manifestUrl);
          const deniedManifest = await foreign.request.get(manifestUrl);
          expect(deniedManifest.status()).toBe(404);
          receipt.foreignAudiobookManifestDenied = deniedManifest.status();
          const chapter = ownerManifest.chapters.find(chapter => chapter.audioUrl);
          if (!chapter?.audioUrl) throw new Error('Owned audiobook has no ready chapter for access-denial verification');
          const bookUrl = `/api/audiobook/books/${encodeURIComponent(ownerManifest.fileName)}`;
          const renderQuery = new URLSearchParams({ file: ownerManifest.fileName, renderId: ownerManifest.renderId });
          const protectedResponse = await context.request.post(`${bookUrl}/bookmarks`, { data: { chapterId: chapter.id, timeSeconds: 0, label: 'Owner access-denial checkpoint' } });
          expect(protectedResponse.ok()).toBe(true);
          const protectedManifest = await manifestRecord(context, manifestUrl);
          const protectedBookmark = protectedManifest.bookmarks.find(bookmark => bookmark.label === 'Owner access-denial checkpoint');
          if (!protectedBookmark) throw new Error('Owner access-denial bookmark missing');
          const ownerAudioBefore = await context.request.get(chapter.audioUrl);
          expect(ownerAudioBefore.status()).toBe(200);
          const ownerAudioHash = sha256(await ownerAudioBefore.body());
          const statuses: Record<string, number> = { manifest: deniedManifest.status() };
          statuses.chapterAudio = (await foreign.request.get(chapter.audioUrl)).status();
          statuses.download = (await foreign.request.get(`/api/audiobook/render-download?${renderQuery}`)).status();
          statuses.progress = (await foreign.request.put(`${bookUrl}/progress`, { data: {
            renderId: ownerManifest.renderId, currentChapterId: chapter.id, currentTimeSeconds: 0, playbackRate: 1,
          } })).status();
          statuses.bookmarkCreate = (await foreign.request.post(`${bookUrl}/bookmarks`, { data: { chapterId: chapter.id, timeSeconds: 0, label: 'Forbidden bookmark' } })).status();
          statuses.bookmarkDelete = (await foreign.request.delete(`${bookUrl}/bookmarks/${protectedBookmark.id}`)).status();
          statuses.audioDelete = (await foreign.request.delete(`${bookUrl}/audio`)).status();
          for (const status of Object.values(statuses)) expect(status).toBe(404);
          const unchanged = await manifestRecord(context, manifestUrl);
          expect(unchanged.listenerState).toEqual(ownerManifest.listenerState);
          expect(unchanged.bookmarks).toEqual(protectedManifest.bookmarks);
          expect(unchanged.bookmarks.some(bookmark => bookmark.id === protectedBookmark.id)).toBe(true);
          const ownerAudioAfter = await context.request.get(chapter.audioUrl);
          expect(ownerAudioAfter.status()).toBe(200);
          expect(sha256(await ownerAudioAfter.body())).toBe(ownerAudioHash);
          expect(unchanged.renderId).toBe(ownerManifest.renderId);
          expect((await context.request.delete(`${bookUrl}/bookmarks/${protectedBookmark.id}`)).ok()).toBe(true);
          receipt.foreignAudiobookDenied = { ...statuses, ownerStateUnchanged: true };
          const ownerEmail = profile.user.email as string;
          const foreignEmail = email; // This block's email belongs to the independently created foreign account.
          // Refresh the original owner UI after the independent fresh-context playback.
          // Otherwise its stale mounted player could legitimately write older progress on exit.
          await page.reload();
          await tab(page, 'Studio');
          await page.getByTestId('audiobook-studio-card').click();
          const switchCheckpoint = await manifestRecord(context, manifestUrl);
          const beforeSwitchChapter = switchCheckpoint.chapters.find(chapter => chapter.id === switchCheckpoint.listenerState.currentChapterId);
          if (!beforeSwitchChapter) throw new Error('Owner pre-switch chapter missing');
          const beforeSwitchMedia = await assertLoadedChapter(page.getByTestId('audiobook-chapter-player'), context, beforeSwitchChapter, switchCheckpoint.listenerState.playbackRate);
          expect(beforeSwitchMedia.paused).toBe(true);
          await expect.poll(() => page.getByTestId('audiobook-chapter-player').locator('audio').evaluate((audio: HTMLAudioElement, target: number) => Math.abs(audio.currentTime - target) < 2, switchCheckpoint.listenerState.currentTimeSeconds)).toBe(true);
          await signOutThroughProfile(page, state => { receipt.profileMenuDiagnostics = state; });
          await signInThroughForm(page, context, foreignEmail);
          expect((await context.request.get(manifestUrl)).status()).toBe(404);
          await page.goto(`/notebook/${id}`);
          await expect(page.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
          await expect(page.getByTestId('audiobook-saved-render')).toHaveCount(0);
          await expect(page.getByTestId('audiobook-chapter-player')).toHaveCount(0);
          await expect(page.locator('audio')).toHaveCount(0);
          await page.goto('/');
          await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
          await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
          const foreignNotebookId = new URL(page.url()).pathname.split('/').pop();
          expect(foreignNotebookId).not.toBe(id);
          const foreignNotebook = await context.request.get(`/api/notebooks/${foreignNotebookId}`);
          expect(foreignNotebook.ok()).toBe(true);
          expect((await foreignNotebook.json()).userId).not.toBe(profile.user.id);
          await tab(page, 'Studio');
          await expect(page.getByTestId('audiobook-studio-card')).toBeVisible();
          await expect(page.getByTestId('audiobook-saved-render')).toHaveCount(0);
          await expect(page.getByTestId('audiobook-chapter-player')).toHaveCount(0);
          await expect(page.locator('audio')).toHaveCount(0);
          await signOutThroughProfile(page, state => { receipt.profileMenuDiagnostics = state; });
          await signInThroughForm(page, context, ownerEmail);
          await page.goto(`/notebook/${id}`);
          await tab(page, 'Studio');
          await page.getByTestId('audiobook-studio-card').click();
          const returnedOwner = page.getByTestId('audiobook-chapter-player');
          const checkpointChapter = switchCheckpoint.chapters.find(chapter => chapter.id === switchCheckpoint.listenerState.currentChapterId);
          if (!checkpointChapter) throw new Error('Owner account switch checkpoint chapter missing');
          const switchedMedia = await assertLoadedChapter(returnedOwner, context, checkpointChapter, switchCheckpoint.listenerState.playbackRate);
          await expect.poll(() => returnedOwner.locator('audio').evaluate((audio: HTMLAudioElement, target: number) => Math.abs(audio.currentTime - target) < 2, switchCheckpoint.listenerState.currentTimeSeconds)).toBe(true);
          expect(switchedMedia.paused).toBe(true);
          receipt.sameBrowserAudiobookIsolation = { realSignOutAndSignIn: true, foreignNotebookId, ownerNotebookDenied: true, noInheritedPlayerOrMedia: true, ownerMediaRestored: switchedMedia };
        }
      } finally { await foreign.close(); }
      receipt.phase = 'downloaded-speech-fidelity'; progress();
      const fidelityContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4182' });
      try { receipt.spokenFidelity = await verifyGeneratedAudioFidelity(await fidelityContext.newPage(), fidelityContext, fidelityManifestPath); } finally { await fidelityContext.close(); }
      if (manifestUrl) {
        receipt.phase = 'delete-saved-audiobook'; progress();
        const before = await manifestRecord(context, manifestUrl);
        const bookUrl = `/api/audiobook/books/${encodeURIComponent(before.fileName)}`;
        const sourceResponse = await context.request.get(`/api/notebooks/${id}/sources`);
        expect(sourceResponse.status()).toBe(200);
        const sourceSnapshot = await sourceResponse.json();
        const sourceList = sourceSnapshot.sources || sourceSnapshot;
        const importedBook = sourceList.find((source: SavedSource & { title: string; metadata?: string | { fileName?: string } }) => {
          const metadata = typeof source.metadata === 'string' ? JSON.parse(source.metadata) : source.metadata;
          return metadata?.fileName === before.fileName;
        });
        expect(importedBook, 'The actual imported book source must exist before audio deletion').toBeTruthy();
        // Create a remaining bookmark so deleting the whole saved audio proves cleanup.
        const chapter = before.chapters.find(chapter => chapter.audioUrl);
        if (!chapter?.audioUrl) throw new Error('Owned audiobook deletion chapter missing');
        expect((await context.request.post(`${bookUrl}/bookmarks`, { data: { chapterId: chapter.id, timeSeconds: 0, label: 'Deletion cleanup checkpoint' } })).ok()).toBe(true);
        const mountedPlayer = page.getByTestId('audiobook-chapter-player');
        await playback(mountedPlayer);
        const nativeAudio = await mountedPlayer.locator('audio').evaluateHandle((audio: HTMLAudioElement) => audio);
        await mountedPlayer.getByRole('button', { name: 'Play', exact: true }).click();
        const startedAt = await nativeAudio.evaluate(audio => audio.currentTime);
        await expect.poll(() => nativeAudio.evaluate(audio => !audio.paused && audio.currentTime)).toBeGreaterThan(startedAt + 0.1);
        const audiobookHeldToken = await holdPlayingNativeAudio(nativeAudio, startedAt);
        const checkpointKey = `studypod:audiobook-progress:v2:${encodeURIComponent(before.fileName)}`;
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), checkpointKey)).not.toBeNull();
        const removed = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `${bookUrl}/audio`);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Delete saved audio', exact: true }).click();
        expect((await removed).status()).toBe(200);
        await expect(mountedPlayer).toHaveCount(0);
        const audiobookDisposal = await observeHeldNativeDisposal(nativeAudio, audiobookHeldToken);
        expect(nativeDisposalEvidencePassed(audiobookDisposal), 'Same previously playing audiobook element must unload and stay stopped').toBe(true);
        receipt.audiobookNativeDisposalV2 = audiobookDisposal;
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), checkpointKey)).toBeNull();
        await nativeAudio.dispose();
        await expect(page.getByTestId('audiobook-saved-render')).toHaveCount(0);
        await expect(page.getByTestId('audiobook-create-full')).toBeVisible();
        const reset = await manifestRecord(context, manifestUrl) as PlaybackManifest & { status: string; canPlay: boolean };
        expect(reset.renderId).toBeNull(); expect(reset.status).toBe('not-started'); expect(reset.canPlay).toBe(false);
        expect(reset.chapters.every(chapter => !chapter.audioUrl)).toBe(true);
        expect(reset.bookmarks).toEqual([]);
        expect(reset.listenerState.currentChapterId).toBeNull();
        expect(reset.listenerState.currentTimeSeconds).toBe(0); expect(reset.listenerState.playbackRate).toBe(1);
        for (const chapter of before.chapters.filter(chapter => chapter.audioUrl)) expect((await context.request.get(chapter.audioUrl!)).status()).toBe(404);
        const query = new URLSearchParams({ file: before.fileName, renderId: before.renderId });
        expect((await context.request.get(`/api/audiobook/render-download?${query}`)).status()).toBe(404);
        expect(await (await context.request.get(`/api/notebooks/${id}/sources`)).json()).toEqual(sourceSnapshot);
        await expect(page.getByRole('heading', { name: importedBook.title, exact: true })).toBeVisible();
        const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', viewport: page.viewportSize() || undefined, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, serviceWorkers: 'block' });
        try {
          const freshPage = await fresh.newPage();
          await signInThroughForm(freshPage, fresh, profile.user.email);
          await freshPage.goto(`/notebook/${id}`); await tab(freshPage, 'Studio');
          await freshPage.getByTestId('audiobook-studio-card').click();
          await expect(freshPage.getByTestId('audiobook-chapter-player')).toHaveCount(0);
          await expect(freshPage.getByTestId('audiobook-saved-render')).toHaveCount(0);
          await expect(freshPage.getByTestId('audiobook-create-full')).toBeVisible();
          await expect(freshPage.getByRole('heading', { name: importedBook.title, exact: true })).toBeVisible();
          const restored = await manifestRecord(fresh, manifestUrl);
          expect(restored.bookmarks).toEqual([]); expect(restored.listenerState).toEqual(reset.listenerState);
          expect(await freshPage.evaluate(key => localStorage.getItem(key), checkpointKey)).toBeNull();
        } finally { await fresh.close(); }
        receipt.audiobookOwnerDeletion = { detachedMediaStopped: true, checkpointRemoved: true, savedRenderRemoved: true, chapterAndExportUnavailable: true, bookmarksRemoved: true, progressReset: true, importedBookRetained: true, freshOwnerAbsence: true };
      }
      if (savedPodcast) {
        receipt.phase = 'delete-saved-podcast'; progress();
        const podcastUrl = `/api/notebooks/${id}/studio/podcasts`;
        const escapedTitle = savedPodcast.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const episode = page.locator('div.group').filter({ has: page.getByRole('button', { name: new RegExp(`^(?:Play ${escapedTitle}|Resume ${escapedTitle} at .+)$`) }) });
        // Delete the episode while its actual decoded media is playing. Server
        // removal alone cannot detect an orphaned blob player continuing to play.
        const deletingPlayer = page.locator('.podcast-player-container');
        const replayAudio = deletingPlayer.locator('audio');
        const previousReplaySource = await replayAudio.evaluate((node: HTMLAudioElement) => node.getAttribute('src'));
        await episode.getByRole('button', { name: new RegExp(`^(?:Play ${escapedTitle}|Resume ${escapedTitle} at .+)$`) }).click();
        const replayState = () => replayAudio.evaluate((node: HTMLAudioElement, previousSource) => ({
          sourceChanged: Boolean(node.getAttribute('src')) && node.getAttribute('src') !== previousSource,
          sourceMatches: Boolean(node.currentSrc) && node.currentSrc === node.src,
          paused: node.paused, duration: node.duration, readyState: node.readyState,
          errorCode: node.error?.code ?? null,
        }), previousReplaySource);
        try {
          await expect.poll(async () => savedHistoryReplayReady(await replayState()), {
            timeout: 30_000, message: 'Saved-history selection must replace and decode its new audio before Play',
          }).toBe(true);
          await expect(deletingPlayer.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
        } catch {
          throw new Error(`Saved-history selection readiness failed: ${JSON.stringify(await replayState())}`);
        }
        receipt.savedHistoryReplaySelection = await replayState(); progress();
        await playback(deletingPlayer, 'saved-history-replay');
        const deletedAudio = await deletingPlayer.locator('audio').evaluateHandle((audio: HTMLAudioElement) => audio);
        expect(deletedAudio).toBeTruthy();
        await deletingPlayer.getByRole('button', { name: 'Play', exact: true }).click();
        const deletionStart = await deletedAudio!.evaluate(node => node.currentTime);
        await expect.poll(() => deletedAudio!.evaluate((node, start) => !node.paused && node.currentTime > start, deletionStart)).toBe(true);
        const podcastHeldToken = await holdPlayingNativeAudio(deletedAudio!, deletionStart);
        const removed = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === `${podcastUrl}/${savedPodcast!.id}`);
        page.once('dialog', dialog => dialog.accept());
        await episode.getByTitle('Delete', { exact: true }).click();
        expect((await removed).status()).toBe(200);
        await expect(deletingPlayer).toHaveCount(0);
        // Keep a handle to the removed element: DOM disappearance alone does not
        // establish that the browser stopped the previously playing media.
        const podcastDisposal = await observeHeldNativeDisposal(deletedAudio!, podcastHeldToken);
        expect(nativeDisposalEvidencePassed(podcastDisposal), 'Same previously playing podcast element must unload and stay stopped').toBe(true);
        receipt.podcastNativeDisposalV2 = podcastDisposal;
        await deletedAudio!.dispose();
        await expect.poll(() => page.evaluate(mediaId => localStorage.getItem('studypod:playback:' + encodeURIComponent(mediaId)), savedPodcast!.id)).toBeNull();
        expect((await context.request.get(`${podcastUrl}/${savedPodcast.id}`)).status()).toBe(404);
        expect((await context.request.get(`${podcastUrl}/${savedPodcast.id}/audio`)).status()).toBe(404);
        await expect.poll(async () => (await (await context.request.get(podcastUrl)).json()).podcasts.length).toBe(0);
        await page.reload();
        await tab(page, 'Studio');
        await expect(page.getByRole('button', { name: `Play ${savedPodcast.title}`, exact: true })).toHaveCount(0);
        const deletedRecent = await context.request.get('/api/notebooks/studio/podcasts/recent');
        expect(deletedRecent.status()).toBe(200);
        expect((await deletedRecent.json()).podcast).toBeNull();
        const deletedUiRecent = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/notebooks/studio/podcasts/recent');
        await page.goto('/');
        const deletedUiResponse = await deletedUiRecent;
        expect(deletedUiResponse.status()).toBe(200);
        expect((await deletedUiResponse.json()).podcast).toBeNull();
        await expect(page.getByRole('heading', { name: 'Saved audio', exact: true })).toBeVisible();
        await expect(page.getByText('No saved audio yet. Open a notebook\'s Studio to create an audio overview.', { exact: true })).toBeVisible();
        await expect(page.getByText(savedPodcast.title, { exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: `Resume ${savedPodcast.title} in ${notebookTitle}` })).toHaveCount(0);
        receipt.podcastOwnerDeletion = { recordRemoved: true, bytesRemoved: true, emptyList: true, absentAfterReload: true, dashboardCueRemoved: true };
      }
      expect(receipt.pageErrorCount).toBe(0);
      receipt.phase = 'passed';
    } catch (error) {
      receipt.failedPhase = receipt.phase; receipt.phase = 'failed';
      // Avoid copying provider responses, request URLs, credentials or headers.
      receipt.failure = error instanceof Error ? error.name : 'UnknownError'; throw error;
    } finally {
      // Best effort only: diagnostic failure must not replace the acceptance failure.
      if (receipt.phase === 'failed') {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          receipt.audioDiagnostics = { ui: await Promise.race([
            audioUiDiagnostic(page),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DiagnosticDeadline')), 3_000); }),
          ]), console: audioConsole, assetEvents };
        } catch {
          receipt.audioDiagnostics = { uiUnavailable: true, console: audioConsole, assetEvents };
        } finally { if (timer) clearTimeout(timer); }
      }
      progress(); await info.attach('audio acceptance receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(info, receipt))), contentType: 'application/json' });
    }
  });
}
