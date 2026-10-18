import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSharedRelease } from './run-shared-account-release.mjs';
import { captureSharedCandidate, readSharedSuiteReceipt, sameSharedCandidate, sharedCandidatePaths } from './shared-release-candidate.mjs';

const env = {
  STUDYPOD_SHARED_ACCOUNT_MODE: 'existing-account-only', STUDYPOD_SHARED_MUTATIONS: 'new-notebooks-only',
  STUDYPOD_SHARED_BASE_URL: 'http://127.0.0.1:4182', STUDYPOD_SHARED_APPROVED_ORIGIN: 'http://127.0.0.1:4182',
  STUDYPOD_SHARED_EMAIL: 'synthetic@example.test', STUDYPOD_SHARED_PASSWORD: 'synthetic',
};
const candidate = { head: 'a'.repeat(40), sourceFingerprint: 'b'.repeat(64), files: [] };
const report = { status: 'passed', inventoryOnly: false, results: [{ scenario: 'source journey', status: 'passed', receipt: { cleanup: 'verified-deleted' } }] };
const readReport = value => readSharedSuiteReceipt('/synthetic', () => Buffer.from(JSON.stringify(value)));
function run(overrides = {}) {
  const calls = [];
  const result = runSharedRelease({ mode: '--run', env, mkdir() {}, write() {}, id: () => 'offline', captureCandidate: () => candidate,
    readSuiteReceipt: () => readReport(report), spawn(_binary, args) { calls.push(args); return { status: 0 }; }, ...overrides });
  return { ...result, calls };
}

test('candidate scope includes runtime, untracked tests, fixtures and deployment config but excludes generated and private inputs', () => {
  const kept = ['src/app.tsx', 'e2e/untracked.test.mjs', 'api/[...route].js', 'backend/python/chatterbox_server.py', 'e2e/fixtures/source.pdf', 'vercel.json'];
  assert.deepEqual(sharedCandidatePaths([...kept, 'uploads/source.txt', 'e2e/test-results/report.json', '.ai-bridge/result.json', 'node_modules/a.js', 'src/.env.json', 'e2e/fixtures/credentials.txt', 'e2e/../secret.pdf', 'src/a.private.json']), kept.sort());
});

test('fingerprint observes dirty content, untracked test additions, and tracked deletions', () => {
  const root = mkdtempSync(join(tmpdir(), 'studypod-candidate-'));
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  try {
    git(['init']); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/app.js'), 'one');
    git(['add', '.']); git(['-c', 'user.name=Offline QA', '-c', 'user.email=offline@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
    const before = captureSharedCandidate(root);
    writeFileSync(join(root, 'src/app.js'), 'two');
    const dirty = captureSharedCandidate(root); assert.equal(sameSharedCandidate(before, dirty), false); assert.equal(before.head, dirty.head);
    mkdirSync(join(root, 'e2e')); writeFileSync(join(root, 'e2e/new.test.mjs'), 'test');
    assert.equal(sameSharedCandidate(dirty, captureSharedCandidate(root)), false);
    rmSync(join(root, 'src/app.js')); assert.equal(captureSharedCandidate(root).files.find(file => file.path === 'src/app.js').absent, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('suite mapping hashes exact report and every nonempty receipt', () => {
  const evidence = readReport(report);
  assert.equal(evidence.receiptCount, 1); assert.equal(evidence.scenarios[0].receiptPointer, '/results/0/receipt');
  assert.match(evidence.reportSha256, /^[a-f0-9]{64}$/); assert.match(evidence.scenarios[0].receiptSha256, /^[a-f0-9]{64}$/);
});

test('missing, empty, inventory, skipped, failed or absent receipt evidence fails closed', () => {
  assert.throws(() => readSharedSuiteReceipt('/missing', () => { throw new Error('missing'); }));
  for (const bad of [{ ...report, results: [] }, { ...report, inventoryOnly: true }, { ...report, status: 'failed' },
    ...['skipped', 'failed'].map(status => ({ ...report, results: [{ ...report.results[0], status }] })),
    ...[null, {}].map(receipt => ({ ...report, results: [{ ...report.results[0], receipt }] }))]) assert.throws(() => readReport(bad));
});

test('all four serial suites map receipts and bind the same candidate', () => {
  const result = run(); assert.equal(result.exitCode, 0); assert.equal(result.calls.length, 4);
  assert.deepEqual(result.summary.results.map(item => item.phase), ['sources', 'studio', 'podcast', 'audiobook']);
  assert.equal(result.summary.status, 'journeys-passed'); assert.equal(result.summary.candidateBinding.status, 'unchanged');
  assert.equal(result.summary.releaseReady, false); assert.ok(result.summary.results.every(item => item.receipts.receiptCount === 1));
});

test('candidate content or HEAD changes reject an otherwise passing run', () => {
  for (const change of [{ ...candidate, sourceFingerprint: 'c'.repeat(64) }, { ...candidate, head: 'd'.repeat(40) }]) {
    let captures = 0;
    const result = run({ captureCandidate: () => captures++ === 0 ? candidate : change });
    assert.equal(result.exitCode, 1); assert.equal(result.summary.status, 'candidate-changed');
  }
});

test('successful child process without receipts fails and still checks final candidate', () => {
  let captures = 0;
  const result = run({ captureCandidate: () => { captures++; return candidate; }, readSuiteReceipt() { throw new Error('empty'); } });
  assert.equal(result.exitCode, 1); assert.equal(result.calls.length, 1); assert.equal(captures, 2);
  assert.equal(result.summary.results[0].failure, 'suite-receipt-missing-or-invalid');
});

test('child failure and candidate capture failure fail closed', () => {
  const child = run({ spawn: () => ({ status: 2 }) }); assert.equal(child.exitCode, 2); assert.equal(child.summary.status, 'failed');
  let captures = 0;
  const missing = run({ captureCandidate() { if (captures++) throw new Error('unavailable'); return candidate; } });
  assert.equal(missing.exitCode, 1); assert.equal(missing.summary.status, 'candidate-unavailable');
});

test('check mode permits an empty inventory while never claiming execution coverage', () => {
  const result = run({ mode: '--check', readSuiteReceipt() { throw new Error('must not read inventory receipts'); } });
  assert.equal(result.exitCode, 0); assert.equal(result.summary.status, 'inventory-passed');
  assert.equal(result.summary.mode, 'inventory-only'); assert.equal(result.summary.releaseReady, false);
});
