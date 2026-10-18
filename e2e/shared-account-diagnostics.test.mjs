import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSharedErrors, sharedFailureCategory } from './shared-account-diagnostics.mjs';
test('removes raw headers and arbitrary error attachments before context capture', () => {
 const errors = [{ message: 'route.fetch Cookie: secret-cookie Authorization: secret-token', stack: 'raw stack secret-cookie', snippet: 'secret-token', value: { request: 'secret-cookie' } }];
 sanitizeSharedErrors(errors);
 assert.deepEqual(Object.keys(errors[0]).sort(), ['message', 'stack']);
 assert.doesNotMatch(JSON.stringify(errors), /secret-cookie|secret-token|Cookie|Authorization|route.fetch/);
});
test('failure categories contain only bounded labels', () => {
 assert.equal(sharedFailureCategory(new Error('Timeout 30000ms with Cookie: private')), 'timeout');
 assert.equal(sharedFailureCategory(new Error('fixture path private')), 'fixture-unavailable');
 assert.equal(sharedFailureCategory(new Error('context closed with headers')), 'context-or-element-closed');
 assert.equal(sharedFailureCategory(new Error('uncontrolled raw error')), 'operation-failed');
});
