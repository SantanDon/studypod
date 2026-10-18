import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
import { captureSharedCandidate, readSharedSuiteReceipt, sameSharedCandidate } from './shared-release-candidate.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = 'node_modules/@playwright/test/cli.js';

export function sharedReleasePlan(mode) {
  if (!['--check', '--run'].includes(mode)) throw new Error('Use --check or --run');
  const inventory = mode === '--check';
  return [
    { phase: 'sources', args: ['e2e/run-shared-account-full.mjs', mode] },
    { phase: 'studio', args: [cli, 'test', '--config', 'e2e/shared-account-studio.config.ts', ...(inventory ? ['--list'] : [])] },
    { phase: 'podcast', args: ['e2e/run-shared-account-audio.mjs', mode] },
    { phase: 'audiobook', args: [cli, 'test', '--config', 'e2e/shared-account-audiobook.config.ts', ...(inventory ? ['--list'] : [])] },
  ];
}

// Dependency injection permits command-order and failure tests without a browser or provider.
export function runSharedRelease({ mode, env = process.env, spawn = spawnSync, mkdir = mkdirSync, write = writeFileSync, captureCandidate = captureSharedCandidate, readSuiteReceipt = readSharedSuiteReceipt, id = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() } = {}) {
  const plan = sharedReleasePlan(mode);
  const origin = validateSharedAccountEnvironment(env, mode === '--run');
  const runDir = resolve(repoRoot, env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/shared-release-gates', id());
  const summary = {
    schemaVersion: 2, mode: mode === '--run' ? 'execution' : 'inventory-only', origin,
    status: 'running', releaseReady: false, results: [],
    candidateBinding: { scope: 'local-source-inputs', status: 'pending' },
    boundaries: ['Existing account only; newly created test notebooks only.', 'Serial desktop journeys; no signup, Terms acceptance, foreign-account, mobile or encrypted-sync coverage.', 'Local source identity does not establish deployed runtime identity; cloud before/after acceptance and audible content validation remain required.'],
  };
  mkdir(runDir, { recursive: true });
  const persist = () => write(resolve(runDir, 'shared-release-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const finish = exitCode => {
    try {
      summary.candidateBinding.after = captureCandidate(repoRoot);
      summary.candidateBinding.unchanged = sameSharedCandidate(summary.candidateBinding.before, summary.candidateBinding.after);
      summary.candidateBinding.status = summary.candidateBinding.unchanged ? 'unchanged' : 'changed';
      if (!summary.candidateBinding.unchanged) { summary.status = 'candidate-changed'; exitCode = 1; }
    } catch {
      summary.candidateBinding.status = 'unavailable'; summary.status = 'candidate-unavailable'; exitCode = 1;
    }
    persist();
    return { exitCode, runDir, summary };
  };
  try { summary.candidateBinding.before = captureCandidate(repoRoot); }
  catch { summary.candidateBinding.status = 'unavailable'; summary.status = 'candidate-unavailable'; persist(); return { exitCode: 1, runDir, summary }; }
  persist();
  for (const step of plan) {
    const artifactDir = resolve(runDir, step.phase);
    mkdir(artifactDir, { recursive: true });
    const childEnv = {
      ...env, DEBUG: '', PWDEBUG: '', PLAYWRIGHT_NO_COPY_PROMPT: '1',
      STUDYPOD_SHARED_ARTIFACTS: artifactDir,
      STUDYPOD_SHARED_INVENTORY_ONLY: mode === '--check' ? '1' : '0',
      STUDYPOD_AUTH_SIGNUP: '0', STUDYPOD_AUTH_TERMS_ACCEPTED: '0',
    };
    let result;
    try {
      result = spawn(process.execPath, step.args, { cwd: repoRoot, env: childEnv, stdio: 'inherit' });
    } catch {
      result = { status: 1, error: true };
    }
    let exitCode = !result?.error && !result?.signal && Number.isInteger(result?.status) && result.status >= 0 ? result.status : 1;
    const evidence = { phase: step.phase, exitCode, artifactDir, ...(result?.error || result?.signal ? { failure: 'child-process-failure' } : {}) };
    if (exitCode === 0 && mode === '--run') {
      try { evidence.receipts = readSuiteReceipt(artifactDir); }
      catch { exitCode = 1; evidence.exitCode = 1; evidence.failure = 'suite-receipt-missing-or-invalid'; }
    }
    summary.results.push(evidence);
    summary.status = exitCode === 0 ? 'running' : 'failed';
    persist();
    if (exitCode !== 0) return finish(exitCode);
  }
  summary.status = mode === '--check' ? 'inventory-passed' : 'journeys-passed';
  return finish(0);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('Use --check or --run; all four phases are required');
  const result = runSharedRelease({ mode: process.argv[2] });
  console.log('Shared-account ' + result.summary.status + ': ' + resolve(result.runDir, 'shared-release-summary.json'));
  process.exitCode = result.exitCode;
}
