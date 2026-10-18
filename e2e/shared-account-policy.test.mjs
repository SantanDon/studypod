import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSharedAccountEnvironment, createSharedMutationPolicy } from './shared-account-policy.mjs';
const origin = 'http://127.0.0.1:4179';
const valid = { STUDYPOD_SHARED_ACCOUNT_MODE: 'existing-account-only', STUDYPOD_SHARED_MUTATIONS: 'new-notebooks-only', STUDYPOD_SHARED_BASE_URL: origin, STUDYPOD_SHARED_APPROVED_ORIGIN: origin };
test('inventory needs explicit scope and origin but no credentials', () => {
  assert.equal(validateSharedAccountEnvironment(valid, false), origin);
  for (const key of Object.keys(valid)) assert.throws(() => validateSharedAccountEnvironment({ ...valid, [key]: '' }, false));
  assert.throws(() => validateSharedAccountEnvironment(valid));
  assert.equal(validateSharedAccountEnvironment({ ...valid, STUDYPOD_SHARED_EMAIL: 'synthetic@example.invalid', STUDYPOD_SHARED_PASSWORD: 'synthetic-only' }), origin);
});
test('signup and Terms flags are rejected even in inventory mode', () => {
  for (const key of ['STUDYPOD_AUTH_SIGNUP', 'STUDYPOD_AUTH_TERMS_ACCEPTED']) assert.throws(() => validateSharedAccountEnvironment({ ...valid, [key]: '1' }, false));
});
test('hosted requires HTTPS and exact origin without credential/path/query', () => {
  for (const target of ['http://public.invalid', 'https://u:p@public.invalid', 'https://public.invalid/sub', 'https://public.invalid/?secret=x', 'https://public.invalid/#x']) assert.throws(() => validateSharedAccountEnvironment({ ...valid, STUDYPOD_SHARED_BASE_URL: target, STUDYPOD_SHARED_APPROVED_ORIGIN: new URL(target).origin }, false));
  assert.equal(validateSharedAccountEnvironment({ ...valid, STUDYPOD_SHARED_BASE_URL: 'https://public.invalid', STUDYPOD_SHARED_APPROVED_ORIGIN: 'https://public.invalid' }, false), 'https://public.invalid');
});
test('signup and external requests fail closed before or after authentication', () => {
  const policy = createSharedMutationPolicy(origin);
  for (let authenticated = 0; authenticated < 2; authenticated++) {
    for (const path of ['/api/auth/signup', '/api/auth/register', '/auth?mode=cloud-signup']) for (const method of ['GET', 'POST']) assert.equal(policy.decide(origin + path, method).allowed, false);
    assert.equal(policy.decide('https://other.invalid/api/auth/signin', 'POST').allowed, false);
    policy.verifyIdentity();
  }
});
test('only session lifecycle mutations allowed until identity verified', () => {
  const policy = createSharedMutationPolicy(origin);
  for (const action of ['signin', 'signout', 'refresh']) assert.equal(policy.decide(`${origin}/api/auth/${action}`, 'POST').allowed, true);
  assert.equal(policy.decide(`${origin}/api/notebooks`, 'POST').allowed, false);
  assert.throws(() => policy.registerCreated('prior-notebook'));
});
test('one captured new notebook owns scoped mutations; prior notebooks and providers blocked', () => {
  const policy = createSharedMutationPolicy(origin); policy.verifyIdentity();
  assert.equal(policy.decide(`${origin}/api/notebooks`, 'POST').captureCreated, true);
  assert.equal(policy.decide(`${origin}/api/notebooks`, 'POST').allowed, false);
  assert.throws(() => policy.registerCreated(undefined));
  policy.registerCreated('new-qa');
  assert.throws(() => policy.registerCreated('other-notebook'));
  for (const method of ['PUT', 'DELETE']) {
    assert.equal(policy.decide(`${origin}/api/notebooks/new-qa`, method).allowed, true);
    assert.equal(policy.decide(`${origin}/api/notebooks/prior-notebook`, method).allowed, false);
  }
  assert.equal(policy.decide(`${origin}/api/notebooks/new-qa/sources`, 'POST').allowed, true);
  for (const path of ['/api/notebooks/prior-notebook/sources', '/api/notebooks/new-qa/chat', '/api/notebooks/new-qa/studio', '/api/user/profile', '/api/ai/generate', '/non-api-mutation']) assert.equal(policy.decide(origin + path, 'POST').allowed, false);
  assert.deepEqual(policy.ids(), ['new-qa']);
});

test('opaque background sync is aborted, distinguished from allowed mutations', () => {
  const policy = createSharedMutationPolicy(origin);
  for (const authenticated of [false, true]) {
    if (authenticated) policy.verifyIdentity();
    assert.deepEqual(policy.decide(origin + '/api/sync/upload', 'POST'), { allowed: false, reason: 'encrypted-background-sync-quarantined', quarantined: true });
    assert.equal(policy.decide(origin + '/api/sync/upload', 'PUT').allowed, false);
    assert.equal(policy.decide(origin + '/api/auth/refresh/other', 'POST').allowed, false);
    assert.equal(policy.decide(origin + '/api/auth/refresh', 'PUT').allowed, false);
    assert.equal(policy.decide('https://foreign.invalid/api/auth/refresh', 'POST').allowed, false);
  }
});
