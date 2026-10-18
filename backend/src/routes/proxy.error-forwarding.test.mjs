import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import express from 'express';

// Read the production route and error middleware, replacing imports with bounded
// mocks. No database, auth credentials, network server or provider is initialized.
const stripImports = source => source.replace(/^import\s[\s\S]*?;\r?\n/gm, '');

async function fixture({ unsafe = false, extractionFailure = false } = {}) {
  const logger = { error() {}, info() {}, warn() {}, debug() {} };
  const errorSource = stripImports(await readFile(new URL('../middleware/errorHandler.js', import.meta.url), 'utf8')).replace(/export /g, '');
  const errors = vm.runInNewContext(`${errorSource}\n({ AppError, errorHandler })`, {
    logger,
    multer: { MulterError: class extends Error {} },
    process: { env: { NODE_ENV: 'production' } },
  });
  let safetyCalls = 0;
  let extractionCalls = 0;
  const routeSource = stripImports(await readFile(new URL('./proxy.js', import.meta.url), 'utf8')).replace('export default router;', 'router;');
  const router = vm.runInNewContext(routeSource, {
    express, ...errors, URL, logger,
    authenticateToken: (_req, _res, next) => next(),
    requireScope: () => ((_req, _res, next) => next()),
    assertSafeExternalHttpsUrl: async () => {
      safetyCalls++;
      if (unsafe) throw new Error('Synthetic unsafe destination');
      return 'https://example.invalid/';
    },
    extractionService: {
      extractWebSource: async () => {
        extractionCalls++;
        if (extractionFailure) throw new Error('Synthetic extraction rejection');
        return { title: 'Fixture', content: 'Offline fixture', metadata: { description: '', method: 'mock' } };
      },
    },
  });
  router.get('/health', (_req, res) => res.json({ status: 'ok' }));
  router.post('/signup', (_req, res) => res.status(201).json({ synthetic: true }));

  function request(path, query = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('In-memory route did not complete')), 500);
      const fail = error => { clearTimeout(timer); reject(error); };
      const req = { method, url: path, originalUrl: path, query };
      const res = {
        headersSent: false, statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); return this; },
      };
      router.handle(req, res, error => error ? errors.errorHandler(error, req, res, fail) : fail(new Error('No route')));
    });
  }
  return { request, calls: () => ({ safetyCalls, extractionCalls }) };
}

async function assertContinuations(fixture) {
  assert.equal((await fixture.request('/health')).status, 200);
  assert.equal((await fixture.request('/signup', {}, 'POST')).status, 201);
}

test('missing web URL completes through actual Express4/error middleware without extraction', async () => {
  const f = await fixture();
  const response = await f.request('/extract-web');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'MISSING_URL');
  assert.deepEqual(f.calls(), { safetyCalls: 0, extractionCalls: 0 });
  await assertContinuations(f);
});

test('rejected web destination safety check returns UNSAFE_URL400 without extraction', async () => {
  const f = await fixture({ unsafe: true });
  const response = await f.request('/extract-web', { url: 'synthetic-url' });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'UNSAFE_URL');
  assert.deepEqual(f.calls(), { safetyCalls: 1, extractionCalls: 0 });
  await assertContinuations(f);
});

test('ordinary extraction rejection retains existing500 response and subsequent mock routes respond', async () => {
  const f = await fixture({ extractionFailure: true });
  const response = await f.request('/extract-web', { url: 'synthetic-url' });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Failed to extract web content');
  assert.deepEqual(f.calls(), { safetyCalls: 1, extractionCalls: 1 });
  await assertContinuations(f);
});

test('successful extraction retains existing response contract', async () => {
  const f = await fixture();
  const response = await f.request('/extract-web', { url: 'synthetic-url' });
  assert.equal(response.status, 200);
  assert.equal(response.body.title, 'Fixture');
  assert.equal(response.body.content, 'Offline fixture');
  assert.equal(response.body.metadata.extractionMethod, 'mock');
  assert.deepEqual(f.calls(), { safetyCalls: 1, extractionCalls: 1 });
  await assertContinuations(f);
});
