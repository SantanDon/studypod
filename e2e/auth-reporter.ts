import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Public report contains only sanitized fields. Redacted diagnostics remain private and ignored.
export default class AuthReporter implements Reporter {
  private scenarios: unknown[] = [];
  onTestEnd(_test: TestCase, result: TestResult) {
    let diagnostics = JSON.stringify(result.errors);
    for (const key of ['STUDYPOD_AUTH_EMAIL', 'STUDYPOD_AUTH_PASSWORD', 'STUDYPOD_AUTH_SECOND_EMAIL', 'STUDYPOD_AUTH_SECOND_PASSWORD']) {
      const value = process.env[key];
      if (value) diagnostics = diagnostics.split(value).join('[redacted]');
    }
    const directory = resolve(process.env.STUDYPOD_AUTH_ARTIFACTS || '.ai-bridge/studypod-auth-gate');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'diagnostics.private.json'), diagnostics);
    const body = result.attachments.find(a => a.name === 'sanitized-acceptance-receipt')?.body;
    this.scenarios.push({ status: result.status, durationMs: result.duration, receipt: body ? JSON.parse(body.toString()) : { phase: 'configuration' } });
    console.log(`Authenticated scenario: ${result.status}; inspect sanitized phase receipt.`);
  }
  onEnd(result: FullResult) {
    const directory = resolve(process.env.STUDYPOD_AUTH_ARTIFACTS || '.ai-bridge/studypod-auth-gate');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ status: result.status, scenarios: this.scenarios }, null, 2));
  }
}
