import { attachmentName, validateDiagnostic } from './helpers/flashcard-count-diagnostics.mjs';
import { inventoryValid, receiptValid, reviewedInventory } from './acceptance-contracts.mjs';
import type { Reporter, TestCase, TestResult, FullResult, FullConfig, Suite } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Detailed receipts are LOCAL PRIVATE diagnostics, even if an attachment calls
// itself sanitized. Only decision.json is suitable for sharing as status evidence.
export default class FullFlowReporter implements Reporter {
  private scenarios: unknown[] = [];
  private statuses: { project: string; scenario: string; status: string }[] = [];
  private expected = reviewedInventory.length;
  private discovered = 0;
  private discoveryValid = false;
  private receiptsValid = true;
  onBegin(_config: FullConfig, suite: Suite) {
    const rows = suite.allTests().map(test => ({ project: test.parent.project()?.name, scenario: test.title.split(':')[0] }));
    this.discovered = rows.length;
    this.discoveryValid = inventoryValid(rows);
  }
  onTestEnd(_test: TestCase, result: TestResult) {
    let diagnostics = JSON.stringify(result.errors);
    for (const key of ['STUDYPOD_AUTH_EMAIL', 'STUDYPOD_AUTH_PASSWORD', 'STUDYPOD_AUTH_SECOND_EMAIL', 'STUDYPOD_AUTH_SECOND_PASSWORD']) {
      const value = process.env[key];
      if (value) diagnostics = diagnostics.split(value).join('[redacted]');
    }
    const directory = resolve(process.env.STUDYPOD_AUTH_ARTIFACTS || '.ai-bridge/studypod-auth-gate');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${_test.parent.project()?.name || 'desktop'}-${_test.title.split(':')[0]}.diagnostics.private.json`), diagnostics);
    const receipts = result.attachments.filter(a => /^(sanitized-acceptance-receipt|sanitized-studio-acceptance-receipt|source-downstream-receipt|audio acceptance receipt)$/.test(a.name)).map(a => {
      try {
        const raw = a.body?.toString() || (a.path ? readFileSync(a.path, 'utf8') : '');
        return JSON.parse(raw);
      } catch { return null; }
    });
    const identity = { project: _test.parent.project()?.name, scenario: _test.title.split(':')[0] };
    if (identity.project === 'desktop' && identity.scenario === 'populated-notebook-deletion') {
      const telemetry = result.attachments.filter(a => a.name === attachmentName);
      if (telemetry.length === 1 && telemetry[0].body && telemetry[0].body.length <= 20000) {
        try {
          const value = JSON.parse(telemetry[0].body.toString());
          if (validateDiagnostic(value)) writeFileSync(resolve(directory, 'cedar-exact-three-flashcard-count-diagnostic.json'), JSON.stringify(value, null, 2));
        } catch { /* Malformed diagnostic attachments never enter the report or decision. */ }
      }
    }
    this.receiptsValid &&= receipts.length === 1 && receiptValid(receipts[0], identity);
    this.scenarios.push({ project: _test.parent.project()?.name, title: _test.title, status: result.status, durationMs: result.duration, receipts, receipt: receipts[0] || { phase: 'receipt-not-attached' } });
    // No titles, attachment strings, errors, URLs, DOM, source text, or account
    // details enter the shareable manifest. Scenario identifiers are constrained.
    const identifier = _test.title.split(':')[0];
    this.statuses.push({ project: ['desktop', 'mobile'].includes(identity.project || '') ? identity.project! : 'unclassified', scenario: reviewedInventory.some(row => row.scenario === identifier) ? identifier : 'unclassified', status: result.status });
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ status: 'running', scenarios: this.scenarios }, null, 2));
    console.log(`Authenticated scenario: ${result.status}; inspect local private phase receipt.`);
  }
  onEnd(result: FullResult) {
    const directory = resolve(process.env.STUDYPOD_AUTH_ARTIFACTS || '.ai-bridge/studypod-auth-gate');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ status: result.status, scenarios: this.scenarios }, null, 2));
    const filtered = process.env.STUDYPOD_FULL_SELECTION !== 'complete';
    writeFileSync(resolve(directory, 'decision.json'), JSON.stringify({
      schemaVersion: 1, finishedAt: new Date().toISOString(), status: result.status,
      selection: filtered ? 'diagnostic-subset' : 'complete-local-discovery',
      expectedCount: this.expected, discoveredCount: this.discovered, discoveryValid: this.discoveryValid, observedCount: this.statuses.length, inventoryValid: inventoryValid(this.statuses),
      receiptsValid: this.receiptsValid,
      scenarioExecutionPassed: !filtered && this.discoveryValid && inventoryValid(this.statuses) && this.receiptsValid && result.status === 'passed' && this.statuses.every(s => s.status === 'passed' && s.scenario !== 'unclassified'),
      candidateBound: false,
      localExecutionPassed: false,
      cloudBeforeRelease: 'not-run', cloudAfterRelease: 'not-run',
      releaseReady: false, scenarios: this.statuses,
    }, null, 2));
  }
}
