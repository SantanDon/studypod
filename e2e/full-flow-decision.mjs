// Constrained, shareable decision. Never copy private receipt/provider content.
import { inventoryValid, reviewedInventory } from './acceptance-contracts.mjs';
export function bindDecision(report, candidate, processExitCode, finalHead) {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const candidateBound = Boolean(candidate && /^[a-f0-9]{40}$/.test(candidate.head || '') &&
    candidate.head === finalHead && ['sourceSha256', 'buildSha256', 'fixtureSha256'].every(key => hash(candidate[key])) &&
    ['sourceStableDuringBuild', 'sourceStableDuringRun', 'buildStableDuringRun', 'fixturesStableDuringRun'].every(key => candidate[key] === true));
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios.map(item => ({
    project: ['mobile', 'desktop'].includes(item?.project) ? item.project : 'unclassified',
    scenario: reviewedInventory.some(row => row.scenario === item?.scenario) ? item.scenario : 'unclassified',
    status: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(item?.status) ? item.status : 'unclassified',
  })) : [];
  const complete = report?.selection === 'complete-local-discovery';
  const expectedCount = reviewedInventory.length;
  const discoveryValid = report?.discoveryValid === true && report?.discoveredCount === expectedCount;
  const observedInventoryValid = inventoryValid(scenarios);
  const scenarioExecutionPassed = Boolean(complete && report?.scenarioExecutionPassed === true && report?.receiptsValid === true &&
    report.status === 'passed' && report.expectedCount === expectedCount && discoveryValid && report.inventoryValid === true && observedInventoryValid && report.observedCount === expectedCount &&
    scenarios.every(item => item.status === 'passed' && item.scenario !== 'unclassified' && item.project !== 'unclassified') &&
    new Set(scenarios.map(item => `${item.project}:${item.scenario}`)).size === scenarios.length);
  return { schemaVersion: 2, finishedAt: new Date().toISOString(),
    selection: complete ? 'complete-local-discovery' : 'diagnostic-subset', expectedCount, observedCount: scenarios.length, discoveryValid, inventoryValid: observedInventoryValid,
    receiptsValid: report?.receiptsValid === true, scenarioExecutionPassed, candidateBound,
    localExecutionPassed: scenarioExecutionPassed && candidateBound && processExitCode === 0,
    candidate: candidateBound ? { head: candidate.head, sourceSha256: candidate.sourceSha256, buildSha256: candidate.buildSha256, fixtureSha256: candidate.fixtureSha256 } : null,
    cloudBeforeRelease: 'not-run', cloudAfterRelease: 'not-run', releaseReady: false, scenarios };
}
