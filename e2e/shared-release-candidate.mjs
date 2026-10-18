import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { candidateInputPaths } from './candidate-inputs.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

export function sharedCandidatePaths(paths) {
  const excluded = /(?:^|\/)(?:node_modules|uploads|\.ai-bridge|\.cache|\.git|dist|coverage|test-results|playwright-report|blob-report|\.env[^/]*|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)(?:\/|$)|\.private\./i;
  const selected = candidateInputPaths(paths).filter(path => !excluded.test(path));
  for (const path of paths) {
    if (typeof path !== 'string' || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || excluded.test(path)) continue;
    if (path === 'vercel.json' || /^(?:api\/.*\.[cm]?[jt]sx?|backend\/python\/.*\.(?:py|txt)|e2e\/(?:fixtures|shared-account-fixtures)\/.*\.(?:pdf|epub|docx?|pptx?|xlsx?|txt|csv|md|wav|mp3|mp4|webm))$/i.test(path)) selected.push(path);
  }
  return [...new Set(selected)].sort();
}

export function captureSharedCandidate(root) {
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true }).toString();
  const head = git(['rev-parse', 'HEAD']).trim();
  const paths = sharedCandidatePaths(git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0'));
  if (!/^[a-f0-9]{40,64}$/.test(head) || paths.length === 0) throw new Error('Candidate identity unavailable');
  const files = paths.map(path => {
    try { return { path, sha256: digest(readFileSync(resolve(root, path))) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { path, absent: true }; }
  });
  return { head, sourceFingerprint: digest(JSON.stringify(files)), files };
}

export function sameSharedCandidate(before, after) {
  return Boolean(before?.head && before?.sourceFingerprint && before.head === after?.head && before.sourceFingerprint === after?.sourceFingerprint);
}

// Each mapping points to the exact receipt in the hashed report, without copying account data.
export function readSharedSuiteReceipt(artifactDir, read = readFileSync) {
  const reportPath = resolve(artifactDir, 'sanitized-report.json');
  const bytes = read(reportPath);
  const report = JSON.parse(bytes.toString());
  if (report.status !== 'passed' || report.inventoryOnly !== false || !Array.isArray(report.results) || report.results.length === 0) throw new Error('Missing executed suite receipts');
  const scenarios = report.results.map((result, index) => {
    if (result.status !== 'passed' || typeof result.scenario !== 'string' || !result.scenario || !result.receipt || typeof result.receipt !== 'object' || Array.isArray(result.receipt) || Object.keys(result.receipt).length === 0) throw new Error('Incomplete suite receipt');
    return { scenario: result.scenario, status: result.status, receiptPointer: `/results/${index}/receipt`, receiptSha256: digest(JSON.stringify(result.receipt)) };
  });
  return { reportPath, reportSha256: digest(bytes), scenarioCount: scenarios.length, receiptCount: scenarios.length, scenarios };
}
