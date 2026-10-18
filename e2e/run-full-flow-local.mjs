import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import dotenv from 'dotenv';
import { makeFixtures } from './full-flow-fixtures.mjs';
import { bindDecision } from './full-flow-decision.mjs';
import { sourceFingerprint } from './candidate-inputs.mjs';
import { verifyAdoptedAudioInputs } from './audio-input-guards.mjs';
import { monitorLifecycle } from './runner-lifecycle.mjs';
import { acceptanceTransportSettings, applyAcceptanceTransportSettings } from './youtube-trust-policy.mjs';


// Acceptance diagnostics are explicitly ineligible for release acceptance evidence.
function diagnosticBuildSettings(flag) {
  const enabled = flag === '1';
  return { enabled, buildMode: enabled ? 'acceptance' : 'production', buildArgs: enabled ? ['--mode', 'acceptance'] : [],
    viteFlag: enabled ? 'true' : 'false', evidenceClass: enabled ? 'acceptance-diagnostics' : 'release-candidate-local' };
}
function classifyDiagnosticDecision(decision, enabled) {
  return enabled ? { ...decision, selection: 'diagnostic-subset', diagnosticBuild: true, evidenceClass: 'acceptance-diagnostics', localExecutionPassed: false, releaseReady: false }
    : { ...decision, diagnosticBuild: false, evidenceClass: 'release-candidate-local' };
}

const diagnosticBuild = diagnosticBuildSettings(process.env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS);
const transportSettings = acceptanceTransportSettings(process.env);
const root = process.cwd();
await verifyAdoptedAudioInputs(root, sourceFingerprint);
if (process.argv.includes('--verify-audio-inputs')) {
  console.log('Adopted audio input guards passed; no application execution.');
  process.exit(0);
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve(root, '.ai-bridge/studypod-renewal-20261012/full-flow', runId);
await mkdir(directory, { recursive: true });
const digest = value => createHash('sha256').update(value).digest('hex');
async function directoryFingerprint(path) {
  const files = [];
  async function visit(relative = '') {
    for (const entry of await readdir(resolve(path, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push({ path: name, sha256: digest(await readFile(resolve(path, name))) });
      else throw new Error('Acceptance input contains an unsupported filesystem entry');
    }
  }
  await visit(); files.sort((a, b) => a.path.localeCompare(b.path));
  return { sha256: digest(JSON.stringify(files)), files };
}
const credentials = { email: `qa-${randomBytes(8).toString('hex')}@studypod.invalid`, password: `QA-${randomBytes(24).toString('hex')}` };
const explicitAudio = { slot: process.env.STUDYPOD_AUDIO_PROVIDER_SLOT || '', provider: process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro', model: process.env.VITE_AUDIO_TRANSCRIPTION_MODEL || 'onnx-community/whisper-base' };
const env = { ...process.env };
// Never inherit private diagnostic destinations from another run.
for (const key of ['STUDYPOD_GROUNDING_CAPTURE', 'STUDYPOD_ACCEPTANCE_SYNTHETIC', 'STUDYPOD_GROUNDING_RUN_DIR']) delete env[key];
// Override every dotenv key Vite or the backend could load in this run.
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.acceptance', '.env.acceptance.local', 'backend/.env']) {
  try { for (const key of Object.keys(dotenv.parse(await readFile(resolve(root, file))))) env[key] = ''; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const key of Object.keys(env)) if (/(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)) env[key] = '';
Object.assign(env, {
  STUDYPOD_ACCEPTANCE_DIAGNOSTICS: diagnosticBuild.enabled ? '1' : '0', VITE_STUDYPOD_ACCEPTANCE_DIAGNOSTICS: diagnosticBuild.viteFlag,
  PLAYWRIGHT_NO_COPY_PROMPT: '1', NODE_ENV: 'development', VERCEL: '', PORT: '4020',
  TURSO_DATABASE_URL: pathToFileURL(resolve(directory, 'acceptance.db')).href,
  TURSO_AUTH_TOKEN: '', JWT_SECRET: randomBytes(48).toString('hex'),
  STUDYPOD_GROUNDING_CAPTURE: '1', STUDYPOD_ACCEPTANCE_SYNTHETIC: '1', STUDYPOD_GROUNDING_RUN_DIR: directory,
  TOKENLLM7_ENABLED: 'false', OVHCLOUD_ENABLED: 'false', OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'qwen3.5:9b', TITAN_TIMEOUT_MS: '45000', TITAN_TOTAL_TIMEOUT_MS: '45000', STUDYPOD_FULL_ISOLATED: '1',
  VITE_AUDIO_TRANSCRIPTION_MODEL: explicitAudio.model, AUDIOBOOK_TTS_PROVIDER: explicitAudio.provider,
  STUDYPOD_AUDIO_PROVIDER_SLOT: explicitAudio.slot,
  // Exercise the hosted frontend's authenticated server path, with Qwen on the
  // backend. Browser-direct inference is a separate self-hosted configuration.
  VITE_ENABLE_OLLAMA: '0', VITE_OLLAMA_MODEL: 'qwen3.5:9b', VITE_OLLAMA_URL: 'http://127.0.0.1:11434', VITE_OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  VITE_API_URL: '/api', STUDYPOD_AUTH_BASE_URL: 'http://127.0.0.1:4182',
  STUDYPOD_FULL_BUILD_DIR: resolve(directory, 'dist'),
  STUDYPOD_AUTH_MUTATIONS_ALLOWED: 'dedicated-test-data', STUDYPOD_AUTH_SIGNUP: '1',
  STUDYPOD_AUTH_TERMS_ACCEPTED: '1', STUDYPOD_AUTH_EMAIL: credentials.email,
  STUDYPOD_AUTH_PASSWORD: credentials.password,
  STUDYPOD_AUTH_SECOND_EMAIL: `qa-${randomBytes(8).toString('hex')}@studypod.invalid`,
  STUDYPOD_AUTH_SECOND_PASSWORD: `QA-${randomBytes(24).toString('hex')}`,
});
applyAcceptanceTransportSettings(env, transportSettings);
await writeFile(resolve(directory, 'youtube-transport-policy.json'), JSON.stringify({ diagnostics: transportSettings.diagnostics, trust: transportSettings.system ? 'system-trial' : 'default', certificateVerificationForced: transportSettings.system }));
await writeFile(resolve(directory, 'credentials.private.json'), JSON.stringify({ ...credentials, secondEmail: env.STUDYPOD_AUTH_SECOND_EMAIL, secondPassword: env.STUDYPOD_AUTH_SECOND_PASSWORD }));
await writeFile(resolve(directory, 'empty.env'), '');
env.DOTENV_CONFIG_PATH = resolve(directory, 'empty.env');
env.STUDYPOD_FULL_FIXTURES = resolve(directory, 'fixtures');
await makeFixtures(env.STUDYPOD_FULL_FIXTURES);
const children = [];
const handles = [];
let executionCode = null;
const interruptTimers = [];
const lifecycle = monitorLifecycle({
  persist: data => writeFile(resolve(directory, 'service-lifecycle.json'), JSON.stringify(data, null, 2)),
  interruptBrowser: child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGINT'); // Give Playwright its normal interrupted-report path.
    const timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32' && child.pid) {
        const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        cleanup.once('error', () => {});
      } else child.kill('SIGKILL');
    }, 5_000);
    interruptTimers.push(timer);
    child.once('exit', () => clearTimeout(timer));
  },
});
async function launch(args, name) {
  const handle = await open(resolve(directory, `${name}.log`), 'w'); handles.push(handle);
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', handle.fd, handle.fd], windowsHide: true });
  children.push(child); if (['backend', 'preview'].includes(name)) lifecycle.watch(child, name); return child;
}
async function finished(child) {
  return await new Promise((accept, reject) => { if (child.exitCode !== null || child.signalCode !== null) return accept(child.exitCode ?? 1); child.once('error', reject); child.once('exit', code => accept(code ?? 1)); });
}
async function free(port) {
  await new Promise((accept, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(accept)); });
}
async function ready(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    lifecycle.assertHealthy();
    if (child.exitCode !== null) throw new Error('Isolated server exited; inspect its private local log');
    try { if ((await fetch(url)).ok) return; } catch { /* readiness */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Isolated server readiness timed out');
}
try {
  await free(4020); await free(4182);
  const sourceBefore = await sourceFingerprint(root);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true }).toString().trim();
  // Never replace assets being served to an already-open development notebook.
  if (await finished(await launch(['node_modules/vite/bin/vite.js', 'build', ...diagnosticBuild.buildArgs, '--outDir', env.STUDYPOD_FULL_BUILD_DIR], 'build')) !== 0) throw new Error('Build failed');
  const sourceAfter = await sourceFingerprint(root);
  const build = await directoryFingerprint(env.STUDYPOD_FULL_BUILD_DIR);
  const fixtures = await directoryFingerprint(env.STUDYPOD_FULL_FIXTURES);
  const candidate = { diagnosticBuild: diagnosticBuild.enabled, buildMode: diagnosticBuild.buildMode, evidenceClass: diagnosticBuild.evidenceClass, releaseEvidenceEligible: !diagnosticBuild.enabled, schemaVersion: 1, capturedAt: new Date().toISOString(), head,
    sourceSha256: sourceAfter.sha256, buildSha256: build.sha256, fixtureSha256: fixtures.sha256,
    sourceStableDuringBuild: sourceBefore.sha256 === sourceAfter.sha256,
    provider: 'ollama', model: env.OLLAMA_MODEL, transcriptionModel: explicitAudio.model, audioProvider: explicitAudio.provider,
    cloudBeforeRelease: 'not-run', cloudAfterRelease: 'not-run', releaseReady: false };
  await writeFile(resolve(directory, 'candidate.json'), JSON.stringify(candidate, null, 2));
  await writeFile(resolve(directory, 'candidate.inventory.private.json'), JSON.stringify({ sourceBefore, sourceAfter, build, fixtures }, null, 2));
  if (!candidate.sourceStableDuringBuild) throw new Error('Candidate inputs changed during build; rerun after writers finish');
  const backend = await launch(['backend/src/server.js'], 'backend');
  await ready('http://127.0.0.1:4020/api/health', backend);
  const preview = await launch(['node_modules/vite/bin/vite.js', 'preview', '--config', 'e2e/full-flow-preview.config.ts'], 'preview');
  await ready('http://127.0.0.1:4182', preview);
  env.STUDYPOD_AUTH_ARTIFACTS = resolve(directory, 'desktop');
  const grep = process.env.STUDYPOD_FULL_GREP || process.argv[2];
  const project = process.env.STUDYPOD_FULL_PROJECT;
  env.STUDYPOD_FULL_SELECTION = diagnosticBuild.enabled || grep || project ? 'diagnostic-subset' : 'complete';
  const filter = [...(grep ? ['--grep', grep] : []), ...(project ? ['--project', project] : [])];
  lifecycle.assertHealthy();
  const browser = await launch(['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/full-flow.config.ts', ...filter], 'desktop');
  lifecycle.trackBrowser(browser);
  const code = await finished(browser);
  executionCode = code;
  lifecycle.assertHealthy();
    const sourceAtEnd = await sourceFingerprint(root);
  const buildAtEnd = await directoryFingerprint(env.STUDYPOD_FULL_BUILD_DIR);
  const fixturesAtEnd = await directoryFingerprint(env.STUDYPOD_FULL_FIXTURES);
  Object.assign(candidate, { completedAt: new Date().toISOString(),
    sourceStableDuringRun: sourceAtEnd.sha256 === sourceAfter.sha256,
    buildStableDuringRun: buildAtEnd.sha256 === build.sha256,
    fixturesStableDuringRun: fixturesAtEnd.sha256 === fixtures.sha256 });
  await writeFile(resolve(directory, 'candidate.json'), JSON.stringify(candidate, null, 2));
  if (!candidate.sourceStableDuringRun || !candidate.buildStableDuringRun || !candidate.fixturesStableDuringRun) throw new Error('Acceptance inputs changed during execution; candidate evidence is invalid');
  if (code !== 0) throw new Error('Full source/chat/Studio gate failed');
  console.log(`Browser scenarios passed; final candidate binding follows. Receipts: ${directory}`);
} catch (error) {
  console.error(`${error.message}. Receipts: ${directory}`); process.exitCode = 1;
} finally {
  lifecycle.beginCleanup();
  for (const child of children) if (child.exitCode === null) {
    if (process.platform === 'win32' && child.pid) await new Promise(done => { const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); cleanup.once('error', done); cleanup.once('exit', done); });
    else child.kill();
  }
  await Promise.all(children.map(child => Promise.race([finished(child).catch(() => 1), new Promise(done => { const timer = setTimeout(done, 2_000); timer.unref(); })])));
  for (const timer of interruptTimers) clearTimeout(timer);
  const serviceLifecycle = await lifecycle.flush();
  await Promise.all(handles.map(h => h.close()));
  let report = null, candidate = null, finalHead = '';
  try { report = JSON.parse(await readFile(resolve(directory, 'desktop', 'decision.json'), 'utf8')); } catch { /* missing or invalid reports fail closed */ }
  try { candidate = JSON.parse(await readFile(resolve(directory, 'candidate.json'), 'utf8')); } catch { /* missing candidate fails closed */ }
  try { finalHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true }).toString().trim(); } catch { /* unverifiable HEAD fails closed */ }
  const decision = classifyDiagnosticDecision(bindDecision(report, candidate, executionCode, finalHead), diagnosticBuild.enabled);
  if (serviceLifecycle.failure || serviceLifecycle.persistenceFailed) {
    Object.assign(decision, { localExecutionPassed: false, releaseReady: false, serviceLifecycleFailed: true });
    process.exitCode = 1;
  }
  if (env.STUDYPOD_FULL_SELECTION === 'complete' && !decision.localExecutionPassed) process.exitCode = 1;
  await writeFile(resolve(directory, 'decision.json'), JSON.stringify(decision, null, 2));
  await mkdir(resolve(directory, 'desktop'), { recursive: true });
  await writeFile(resolve(directory, 'desktop', 'decision.json'), JSON.stringify(decision, null, 2));
  if (executionCode === 0 && !serviceLifecycle.failure && !serviceLifecycle.persistenceFailed) console.log(`${decision.localExecutionPassed ? 'Complete local acceptance passed' : 'Diagnostic scenarios finished; complete local acceptance remains unverified'}. Cloud release remains unverified. Receipts: ${directory}`);
}
