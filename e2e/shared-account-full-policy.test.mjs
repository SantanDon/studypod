import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedFullPolicy } from './shared-account-full-policy.mjs';
const origin = 'http://localhost:4182';
test('full runner preserves existing-only and verified new notebook boundary', () => {
  const p = createSharedFullPolicy(origin);
  assert.equal(p.decide(`${origin}/api/ai/generate`, 'POST').allowed, false);
  p.verifyIdentity();
  assert.equal(p.decide(`${origin}/api/ai/generate`, 'POST').allowed, false);
  assert.equal(p.decide(`${origin}/api/notebooks`, 'POST').captureCreated, true);
  p.registerCreated('new-notebook');
  for (const path of ['/api/ai/generate', '/api/youtube/youtube-transcript', '/api/notebooks/new-notebook/chat', '/api/notebooks/new-notebook/studio/decks']) assert.equal(p.decide(origin + path, 'POST').allowed, true);
  for (const path of ['/api/auth/signup', '/api/notebooks', '/api/user/profile', '/api/notebooks/existing/chat', '/api/notebooks/new-notebook/join', '/api/notebooks/new-notebook/webhooks']) assert.equal(p.decide(origin + path, 'POST').allowed, false);
  assert.equal(p.decide('https://elsewhere.test/api/ai/generate', 'POST').allowed, false);
});

test('source upload state updates stay inside the newly captured notebook', () => {
  const p = createSharedFullPolicy(origin);
  const own = origin + '/api/notebooks/new-notebook/sources/source-123';
  assert.equal(p.decide(own, 'PUT').allowed, false);
  p.verifyIdentity();
  assert.equal(p.decide(own, 'PUT').allowed, false);
  assert.equal(p.decide(origin + '/api/notebooks', 'POST').captureCreated, true);
  p.registerCreated('new-notebook');
  assert.equal(p.decide(own, 'PUT').allowed, true);
  for (const path of ['/api/notebooks/existing/sources/source-123', '/api/notebooks/new-notebook/sources/source-123/extra', '/api/notebooks/new-notebook/sources/../webhooks']) assert.equal(p.decide(origin + path, 'PUT').allowed, false);
  assert.equal(p.decide('https://elsewhere.test/api/notebooks/new-notebook/sources/source-123', 'PUT').allowed, false);
  assert.equal(p.decide(own, 'PATCH').allowed, false);
});

const pdfPath = origin + '/api/pdf/process-pdf';
const pdfBytes = Buffer.from('%PDF-1.7\nSynthetic Cedar QA fixture\n%%EOF');
function capturedPolicy() {
  const p = createSharedFullPolicy(origin);
  p.verifyIdentity();
  assert.equal(p.decide(origin + '/api/notebooks', 'POST').captureCreated, true);
  p.registerCreated('new-notebook');
  return p;
}
function pdfRequest({ name = 'cedar.pdf', bytes = pdfBytes, type = 'application/pdf', extra = '' } = {}) {
  const boundary = '----SyntheticQaBoundary42';
  return { contentType: 'multipart/form-data; boundary=' + boundary, body: Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + type + '\r\n\r\n'), bytes,
    Buffer.from(extra + '\r\n--' + boundary + '--\r\n'),
  ]) };
}

test('PDF extraction requires approved bytes after identity and QA notebook creation', () => {
  const p = createSharedFullPolicy(origin);
  const request = pdfRequest();
  assert.equal(p.decide(pdfPath, 'POST', request).allowed, false);
  assert.throws(() => p.registerPdfFixture('cedar.pdf', pdfBytes));
  p.verifyIdentity();
  assert.equal(p.decide(pdfPath, 'POST', request).allowed, false);
  assert.throws(() => p.registerPdfFixture('cedar.pdf', pdfBytes));
  p.decide(origin + '/api/notebooks', 'POST'); p.registerCreated('new-notebook');
  assert.equal(p.decide(pdfPath, 'POST', request).allowed, false);
  p.registerPdfFixture('cedar.pdf', pdfBytes);
  assert.equal(p.decide(pdfPath, 'POST', request).allowed, true);
  assert.throws(() => p.registerPdfFixture('cedar.pdf', pdfBytes));
});

test('PDF permission rejects other files, metadata, endpoints, origins and methods', () => {
  const p = capturedPolicy();
  p.registerPdfFixture('cedar.pdf', pdfBytes);
  const request = pdfRequest();
  for (const candidate of [undefined, {}, pdfRequest({ name: 'personal.pdf' }), pdfRequest({ bytes: Buffer.from('%PDF-1.7\nOther account document') }), pdfRequest({ type: 'text/plain' }), pdfRequest({ extra: '\r\n------SyntheticQaBoundary42\r\nContent-Disposition: form-data; name="notebookId"\r\n\r\nexisting-notebook' }), pdfRequest({ extra: '\r\n------SyntheticQaBoundary42\r\nContent-Disposition: form-data; name="file"; filename="personal.pdf"\r\nContent-Type: application/pdf\r\n\r\nOther file' }), { ...request, contentType: 'application/json' }, { ...request, body: request.body.subarray(0, -3) }]) {
    assert.equal(p.decide(pdfPath, 'POST', candidate).allowed, false);
  }
  for (const [url, method] of [['https://elsewhere.test/api/pdf/process-pdf', 'POST'], [pdfPath + '?notebookId=existing', 'POST'], [pdfPath, 'PUT'], [pdfPath, 'DELETE'], [pdfPath + '/extra', 'POST'], [origin + '/api/notebooks/existing/sources', 'POST'], [origin + '/api/user/profile', 'POST']]) assert.equal(p.decide(url, method, request).allowed, false);
});

test('PDF fixture approval rejects arbitrary names and non-PDF bytes and snapshots its bytes', () => {
  const p = capturedPolicy();
  assert.throws(() => p.registerPdfFixture('personal.pdf', pdfBytes));
  assert.throws(() => p.registerPdfFixture('cedar.pdf', Buffer.from('Not a PDF')));
  const mutable = Buffer.from(pdfBytes); p.registerPdfFixture('cedar.pdf', mutable); mutable.fill(0);
  assert.equal(p.decide(pdfPath, 'POST', pdfRequest()).allowed, true);
});

test('PDF permission accepts native multipart file serialization without network access', async () => {
  const p = capturedPolicy(); p.registerPdfFixture('cedar.pdf', pdfBytes);
  const form = new FormData(); form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'cedar.pdf');
  const request = new Request(pdfPath, { method: 'POST', body: form });
  const metadata = { contentType: request.headers.get('content-type'), body: Buffer.from(await request.arrayBuffer()) };
  assert.equal(p.decide(pdfPath, 'POST', metadata).allowed, true);
});

const epubPath = origin + '/api/audiobook/extract?persist=false';
const epubBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('Synthetic Cedar EPUB ZIP')]);
const epubRequest = (options = {}) => pdfRequest({ name: 'cedar.epub', bytes: epubBytes, type: 'application/epub+zip', ...options });
test('EPUB extraction is limited to registered QA fixture and explicit nonpersistent query', async () => {
  const p = createSharedFullPolicy(origin);
  assert.throws(() => p.registerEpubFixture('cedar.epub', epubBytes));
  assert.equal(p.decide(epubPath, 'POST', epubRequest()).allowed, false);
  p.verifyIdentity();
  assert.throws(() => p.registerEpubFixture('cedar.epub', epubBytes));
  p.decide(origin + '/api/notebooks', 'POST'); p.registerCreated('new-notebook');
  assert.equal(p.decide(epubPath, 'POST', epubRequest()).allowed, false);
  assert.throws(() => p.registerEpubFixture('personal.epub', epubBytes));
  assert.throws(() => p.registerEpubFixture('cedar.epub', Buffer.from('Not ZIP')));
  const bytes = Buffer.from(epubBytes); p.registerEpubFixture('cedar.epub', bytes); bytes.fill(0);
  assert.throws(() => p.registerEpubFixture('cedar.epub', epubBytes));
  assert.equal(p.decide(epubPath, 'POST', epubRequest()).allowed, true);
  const form = new FormData(); form.append('file', new Blob([epubBytes], { type: 'application/epub+zip' }), 'cedar.epub');
  const request = new Request(epubPath, { method: 'POST', body: form });
  assert.equal(p.decide(epubPath, 'POST', { contentType: request.headers.get('content-type'), body: Buffer.from(await request.arrayBuffer()) }).allowed, true);
});
test('EPUB denies persistent extraction, foreign files, extra parts and unrelated mutations', () => {
  const p = capturedPolicy(); p.registerEpubFixture('cedar.epub', epubBytes);
  const request = epubRequest();
  for (const candidate of [undefined, {}, epubRequest({ name: 'personal.epub' }), epubRequest({ type: 'application/zip' }), epubRequest({ bytes: Buffer.from('foreign book') }), epubRequest({ extra: '\r\n------SyntheticQaBoundary42\r\nContent-Disposition: form-data; name="persist"\r\n\r\nfalse' }), { ...request, contentType: 'application/json' }, { ...request, body: request.body.subarray(0, -4) }]) assert.equal(p.decide(epubPath, 'POST', candidate).allowed, false);
  for (const path of ['/api/audiobook/extract', '/api/audiobook/extract?persist=true', '/api/audiobook/extract?persist=False', '/api/audiobook/extract?persist=false&persist=false', '/api/audiobook/extract?persist=false&notebookId=existing', '/api/audiobook/extract?%70ersist=false', '/api/audiobook/books/other/audio', '/api/user/profile']) assert.equal(p.decide(origin + path, 'POST', request).allowed, false);
  for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal(p.decide(epubPath, method, request).allowed, false);
  assert.equal(p.decide('https://elsewhere.test/api/audiobook/extract?persist=false', 'POST', request).allowed, false);
});
test('Whisper assets require captured QA notebook and explicit audio scenario registration', () => {
  const p = createSharedFullPolicy(origin);
  const asset = 'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json';
  assert.throws(() => p.registerAudioAssets());
  assert.equal(p.decide(asset, 'GET').allowed, false);
  p.verifyIdentity(); assert.throws(() => p.registerAudioAssets());
  p.decide(origin + '/api/notebooks', 'POST'); p.registerCreated('new-notebook');
  assert.equal(p.decide(asset, 'GET').allowed, false);
  p.registerAudioAssets();
  assert.equal(p.decide(asset, 'GET').allowed, true);
  assert.equal(p.decide(asset, 'HEAD').allowed, true);
});
test('Whisper permits only exact read-only dependency paths and denies other hosts or mutations', () => {
  const p = capturedPolicy(); p.registerAudioAssets();
  const prefix = 'https://huggingface.co/onnx-community/';
  for (const model of ['tiny', 'base']) for (const path of ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'preprocessor_config.json', 'generation_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']) assert.equal(p.decide(prefix + 'whisper-' + model + '/resolve/main/' + path, 'GET').allowed, true);
  const wasm = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.';
  for (const extension of ['mjs', 'wasm']) assert.equal(p.decide(wasm + extension, 'GET').allowed, true);
  const asset = prefix + 'whisper-tiny/resolve/main/config.json';
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal(p.decide(asset, method).allowed, false);
  for (const url of [asset + '?download=true', asset + '/extra', asset.replace('main', 'other'), asset.replace('whisper-tiny', 'whisper-large'), asset.replace('huggingface.co', 'evil.test'), asset.replace('https:', 'http:'), 'https://huggingface.co/api/models', 'https://cdn-lfs.huggingface.co/foreign.bin', wasm.replace('1.31.0-dev.20260914-8d85527a0', 'latest') + 'wasm', wasm + 'js', 'https://cdn.jsdelivr.net/npm/unrelated/index.js']) assert.equal(p.decide(url, 'GET').allowed, false);
  assert.equal(p.decide(origin + '/api/user/profile', 'PUT').allowed, false);
});


test('Chromium FilePayload exposes exact PDF and EPUB bytes to the unchanged strict guard', async () => {
  const { chromium } = await import('playwright');
  const { mkdtemp, writeFile, unlink, rmdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(), 'studypod-upload-policy-'));
  const browser = await chromium.launch({ headless: true });
  const written = [];
  try {
    const page = await browser.newPage();
    const captures = [];
    // Every request is fulfilled locally; there is no server or provider traffic.
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.method() === 'POST') captures.push({
        url: request.url(),
        contentType: request.headers()['content-type'],
        body: request.postDataBuffer(),
      });
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<input type="file">' });
    });
    await page.goto(origin);
    for (const fixture of [
      { name: 'cedar.pdf', mimeType: 'application/pdf', buffer: pdfBytes, url: pdfPath, register: 'registerPdfFixture' },
      { name: 'cedar.epub', mimeType: 'application/epub+zip', buffer: epubBytes, url: epubPath, register: 'registerEpubFixture' },
    ]) {
      const policy = capturedPolicy();
      policy[fixture.register](fixture.name, fixture.buffer);
      const input = page.locator('input');
      const submit = async () => page.evaluate(async url => {
        const form = new FormData();
        form.append('file', document.querySelector('input').files[0]);
        await fetch(url, { method: 'POST', body: form });
      }, fixture.url);
      const path = join(folder, fixture.name);
      await writeFile(path, fixture.buffer); written.push(path);
      await input.setInputFiles(path);
      await submit();
      const fromPath = captures.at(-1);
      // CDP currently omits filesystem-backed bodies. Missing bytes must stay denied.
      if (!Buffer.isBuffer(fromPath.body)) assert.equal(policy.decide(fromPath.url, 'POST', fromPath).allowed, false);
      await input.setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer });
      await submit();
      const approved = captures.at(-1);
      assert.equal(Buffer.isBuffer(approved.body), true);
      assert.equal(policy.decide(approved.url, 'POST', approved).allowed, true);
      await input.setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: Buffer.concat([fixture.buffer, Buffer.from('foreign')]) });
      await submit();
      const foreign = captures.at(-1);
      assert.equal(policy.decide(foreign.url, 'POST', foreign).allowed, false);
    }
    assert.equal(captures.length, 6);
  } finally {
    await browser.close();
    for (const path of written) await unlink(path);
    await rmdir(folder);
  }
});
