import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapSharedPreview, validateSharedPreviewLink } from './shared-preview-access.mjs';

const origin = 'https://candidate.example';
const link = origin + '/?share=synthetic-sensitive-value';
function mockContext(replies) {
  const calls = [];
  let disposed = 0;
  return {
    calls,
    disposed: () => disposed,
    request: { async get(url, options) {
      calls.push({ url, options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.ok(reply, 'Unexpected request');
      return { status: () => reply.status, headers: () => ({ location: reply.location }), dispose: async () => { disposed++; } };
    } },
  };
}

test('absent access link performs no request, including loopback', async () => {
  const context = mockContext([]);
  assert.deepEqual(await bootstrapSharedPreview(context, 'http://localhost:4173', ''), { enabled: false });
  assert.equal(context.calls.length, 0);
});

test('HTTPS origin is exact and rejects credentials, fragment and foreign origin', () => {
  for (const value of ['https://foreign.example/?share=x', 'https://user:pass@candidate.example/', origin + '/#secret', 'http://candidate.example/']) {
    assert.throws(() => validateSharedPreviewLink(value, origin), { message: 'Preview access link rejected' });
  }
  for (const target of ['http://candidate.example', origin + '/', origin + '/path', origin + '?x=y']) {
    assert.throws(() => validateSharedPreviewLink(link, target), { message: 'Preview access link rejected' });
  }
});

test('same-context GET bootstrap follows only bounded validated redirects and disposes responses', async () => {
  const context = mockContext([{ status: 302, location: '/access' }, { status: 307, location: origin + '/' }, { status: 200 }]);
  assert.deepEqual(await bootstrapSharedPreview(context, origin, link), { enabled: true });
  assert.deepEqual(context.calls.map(call => call.url), [link, origin + '/access', origin + '/']);
  assert.ok(context.calls.every(call => call.options.maxRedirects === 0 && call.options.timeout === 15000 && call.options.failOnStatusCode === false));
  assert.equal(context.disposed(), 3);
});

test('foreign redirect is never requested and rejected errors disclose no link', async () => {
  const context = mockContext([{ status: 302, location: 'https://foreign.example/?secret=synthetic' }]);
  await assert.rejects(bootstrapSharedPreview(context, origin, link), { message: 'Preview access bootstrap failed' });
  assert.equal(context.calls.length, 1);
  assert.equal(context.disposed(), 1);
});

test('five redirects are allowed; sixth redirect is not followed', async () => {
  const allowed = mockContext([...Array.from({ length: 5 }, () => ({ status: 302, location: '/' })), { status: 204 }]);
  assert.deepEqual(await bootstrapSharedPreview(allowed, origin, link), { enabled: true });
  assert.equal(allowed.calls.length, 6);
  const loop = mockContext(Array.from({ length: 6 }, () => ({ status: 302, location: '/' })));
  await assert.rejects(bootstrapSharedPreview(loop, origin, link), { message: 'Preview access bootstrap failed' });
  assert.equal(loop.calls.length, 6);
  assert.equal(loop.disposed(), 6);
});

test('transport and non-success responses produce only generic errors', async () => {
  for (const reply of [new Error('GET ' + link), { status: 403 }, { status: 302 }]) {
    const context = mockContext([reply]);
    await assert.rejects(bootstrapSharedPreview(context, origin, link), { message: 'Preview access bootstrap failed' });
  }
});
