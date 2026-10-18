import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default class FullSharedReporter implements Reporter {
  private results: unknown[] = [];
  private writePartial() {
    const path = process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/release-20261018/shared-full-acceptance';
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'partial-report.json'), JSON.stringify({ status: 'running', inventoryOnly: process.env.STUDYPOD_SHARED_INVENTORY_ONLY === '1', legacy106Eligible: false, results: this.results }, null, 2));
  }
  onTestBegin(test: TestCase) {
    console.log('started: ' + test.title);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const receipt = result.attachments.find(a => a.name === 'shared-account-receipt');
    this.results.push({ scenario: test.title, status: result.status, durationMs: result.duration, receipt: receipt?.body ? JSON.parse(receipt.body.toString()) : null });
    this.writePartial();
    console.log(`${result.status}: ${test.title}`);
  }
  onError() { this.results.push({ status: 'failed', phase: 'runner-error' }); }
  onEnd(result: FullResult) {
    const path = process.env.STUDYPOD_SHARED_ARTIFACTS || '.ai-bridge/release-20261018/shared-full-acceptance';
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'sanitized-report.json'), JSON.stringify({ status: result.status, inventoryOnly: process.env.STUDYPOD_SHARED_INVENTORY_ONLY === '1', legacy106Eligible: false, results: this.results }, null, 2));
  }
}
