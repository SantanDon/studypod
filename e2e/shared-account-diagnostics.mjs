// Raw Playwright request failures can include cookies and authorization headers.
// Run before Playwright's fixture teardown builds error-context.md.
export function sanitizeSharedErrors(errors) {
  for (const error of errors) {
    for (const key of Object.keys(error)) delete error[key];
    error.message = 'Shared-account acceptance failed; see the sanitized receipt for stage and failure category.';
    error.stack = 'Error: Shared-account acceptance failed; see the sanitized receipt.';
  }
}
export function sharedFailureCategory(error) {
  const message = String(error?.message || '');
  if (/fixture/i.test(message)) return 'fixture-unavailable';
  if (/closed|disposed|detached/i.test(message)) return 'context-or-element-closed';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/expect\(|assert/i.test(message)) return 'assertion';
  return 'operation-failed';
}
