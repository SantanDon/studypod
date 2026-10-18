import type { Reporter, TestCase, TestResult, FullResult, FullConfig, Suite } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default class SharedReporter implements Reporter {
  private results: unknown[] = [];
  private discoveredScenarios = 0;
  onBegin(_config: FullConfig, suite: Suite) { this.discoveredScenarios = suite.allTests().length; }
  onTestEnd(test: TestCase, result: TestResult) {
    const receipt = result.attachments.find(a => a.name === 'shared-account-receipt');
    this.results.push({ scenario: test.title, status: result.status, durationMs: result.duration, failureKind: result.error ? (result.error.message?.includes('Timeout') ? 'timeout' : 'assertion-or-runtime') : null, receipt: receipt?.body ? JSON.parse(receipt.body.toString()) : null });
  }
  onError() { this.results.push({ status: 'failed', failureKind: 'runner-error' }); }
  onEnd(result: FullResult) {
    const directory = process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/shared-account-acceptance';
    mkdirSync(directory, { recursive: true });
    const inventoryOnly = process.env.STUDYPOD_SHARED_INVENTORY_ONLY === '1';
    writeFileSync(join(directory, 'sanitized-report.json'), JSON.stringify({ mode: inventoryOnly ? 'inventory-only' : 'real-existing-account', status: result.status, userFacingPass: !inventoryOnly && result.status === 'passed' && this.results.length === 1, discoveredScenarios: this.discoveredScenarios, full106Eligible: false, results: this.results }, null, 2));
    console.log(`Existing-account ${inventoryOnly ? 'inventory' : 'auth/source diagnostic'}: ${result.status}; discovered=${this.discoveredScenarios}; full106Eligible=false`);
  }
}
