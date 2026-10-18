import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindDecision } from './full-flow-decision.mjs';
import { reviewedInventory } from './acceptance-contracts.mjs';

const head = 'a'.repeat(40);
const candidate = { head, sourceSha256: 'b'.repeat(64), buildSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), sourceStableDuringBuild: true, sourceStableDuringRun: true, buildStableDuringRun: true, fixturesStableDuringRun: true };
const report = { selection: 'complete-local-discovery', status: 'passed', expectedCount: reviewedInventory.length, discoveredCount: reviewedInventory.length, discoveryValid: true, inventoryValid: true, observedCount: reviewedInventory.length, receiptsValid: true, scenarioExecutionPassed: true, scenarios: reviewedInventory.map(row => ({ ...row, status: 'passed' })) };

test('complete successful execution binds exact candidate but never grants cloud release', () => {
  const decision = bindDecision(report, candidate, 0, head);
  assert.equal(decision.localExecutionPassed, true);
  assert.equal(decision.releaseReady, false);
  assert.deepEqual(decision.candidate, { head, sourceSha256: candidate.sourceSha256, buildSha256: candidate.buildSha256, fixtureSha256: candidate.fixtureSha256 });
});
test('final binding independently rejects reduced, substituted, duplicate and undiscovered inventories', () => {
  const rows = report.scenarios;
  for (const change of [
    { expectedCount: 1, observedCount: 1, discoveredCount: 1, scenarios: rows.slice(0, 1) },
    { expectedCount: rows.length - 1, observedCount: rows.length - 1, discoveredCount: rows.length - 1, scenarios: rows.slice(1) },
    { discoveryValid: false }, { discoveryValid: undefined }, { discoveredCount: undefined }, { inventoryValid: false },
    { scenarios: [{ ...rows[0], project: 'mobile' }, ...rows.slice(1)] },
    { scenarios: [{ ...rows[0], project: 'unknown' }, ...rows.slice(1)] },
    { scenarios: [{ ...rows[0], scenario: 'unknown' }, ...rows.slice(1)] },
    { scenarios: [rows[1], ...rows.slice(1)] },
  ]) assert.equal(bindDecision({ ...report, ...change }, candidate, 0, head).localExecutionPassed, false);
});
test('missing evidence, failed processes, changed HEAD and each unstable input fail closed', () => {
  for (const inputs of [[null, candidate, 0, head], [report, null, 0, head], [report, candidate, 1, head], [report, candidate, null, head], [report, candidate, 0, 'e'.repeat(40)]]) assert.equal(bindDecision(...inputs).localExecutionPassed, false);
  for (const key of ['sourceStableDuringBuild', 'sourceStableDuringRun', 'buildStableDuringRun', 'fixturesStableDuringRun', 'sourceSha256', 'buildSha256', 'fixtureSha256']) assert.equal(bindDecision(report, { ...candidate, [key]: false }, 0, head).localExecutionPassed, false);
});
test('subsets, missing receipts, missing cases and invalid scenarios cannot pass', () => {
  for (const change of [{ selection: 'diagnostic-subset' }, { receiptsValid: false }, { expectedCount: 2 }, { observedCount: 0 }, { scenarios: [null] }, { scenarios: [{ project: 'unknown', scenario: 'source-intake', status: 'passed' }] }, { scenarios: [{ project: 'desktop', scenario: 'private title!', status: 'passed' }] }, { scenarios: [{ project: 'desktop', scenario: 'source-intake', status: 'skipped' }] }, { expectedCount: 2, observedCount: 2, scenarios: [report.scenarios[0], report.scenarios[0]] }]) assert.equal(bindDecision({ ...report, ...change }, candidate, 0, head).localExecutionPassed, false);
});
