import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as contracts from './acceptance-contracts.mjs';
import { validReceipt } from './acceptance-test-fixtures.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./full-flow-reporter.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function decision({ selection = 'complete', rows = contracts.reviewedInventory, discovered = rows, status = 'passed', finalStatus = 'passed', observed = true, mutateReceipt, duplicateAttachment = false } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'studypod-reporter-'));
  try {
    const exports = {};
    const environment = { STUDYPOD_AUTH_ARTIFACTS: directory, STUDYPOD_FULL_SELECTION: selection, STUDYPOD_AUTH_PASSWORD: 'private-password-canary' };
    const load = id => id === './acceptance-contracts.mjs' ? contracts : require(id);
    runInNewContext(compiled, { exports, require: load, process: { env: environment }, console: { log() {} }, Buffer });
    const reporter = new exports.default();
    const testCase = row => ({ title: `${row.scenario}: private title`, parent: { project: () => ({ name: row.project }) } });
    reporter.onBegin({}, { allTests: () => discovered.map(testCase) });
    if (observed) for (const row of rows) {
      const receipt = contracts.reviewedContracts[row.scenario] ? validReceipt(row) : {};
      mutateReceipt?.(receipt);
      const attachment = { name: 'source-downstream-receipt', body: Buffer.from(JSON.stringify(receipt)) };
      reporter.onTestEnd(testCase(row), { status, duration: 1, errors: [{ message: 'private-password-canary private-error-canary' }], attachments: duplicateAttachment ? [attachment, attachment] : [attachment] });
    }
    reporter.onEnd({ status: finalStatus });
    return readFileSync(resolve(directory, 'decision.json'), 'utf8');
  } finally {
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.split(sep).at(-1).startsWith('studypod-reporter-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('complete scenario execution awaits candidate binding without approving release or exposing private diagnostics', () => {
  const raw = decision();
  const result = JSON.parse(raw);
  assert.equal(result.scenarioExecutionPassed, true);
  assert.equal(result.candidateBound, false);
  assert.equal(result.localExecutionPassed, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.cloudBeforeRelease, 'not-run');
  assert.equal(result.cloudAfterRelease, 'not-run');
  assert.doesNotMatch(raw, /private|password|email|source-canary|error-canary/);
});

test('subset, interrupted, unknown, duplicate, missing and invalid receipts cannot pass execution', () => {
  const all = contracts.reviewedInventory;
  for (const options of [
    { selection:'diagnostic-subset' }, { selection:'' }, { rows:all.slice(1) }, { rows:[] }, { observed:false },
    { discovered:all.slice(1) }, { rows:[...all.slice(1), all[1]] },
    { rows:[...all.slice(1), {project:'unknown',scenario:all[0].scenario}] },
    { rows:[...all.slice(1), {project:'desktop',scenario:'unknown'}] },
    { status:'failed',finalStatus:'failed' }, { status:'skipped' }, { finalStatus:'interrupted' },
    { mutateReceipt:r => r.evidence = {} }, { mutateReceipt:r => r.project = 'unknown' }, { duplicateAttachment:true },
  ]) {
    const result = JSON.parse(decision(options));
    assert.equal(result.scenarioExecutionPassed, false);
    assert.equal(result.localExecutionPassed, false);
    assert.equal(result.releaseReady, false);
  }
});
