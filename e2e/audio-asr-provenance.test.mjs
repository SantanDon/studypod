import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeAudioAsrProvenance } from './audio-asr-provenance.mjs';

function setup(enabled = true) {
  const page = new EventEmitter();
  page.context = () => ({ browser: () => ({ version: () => '123.0' }) });
  return { page, capture: observeAudioAsrProvenance(page, { enabled, origin: 'http://127.0.0.1:4182', configuredModel: 'onnx-community/whisper-base' }) };
}
test('opt-in observer hashes bounded extractor/config only and drops query strings', async () => {
  const { page, capture } = setup();
  let bodies = 0;
  const emit = (url, body = 'safe', length = '4') => page.emit('response', { url: () => url, status: () => 200, headers: () => ({ 'content-length': length }), body: async () => { bodies++; return Buffer.from(body); } });
  emit('http://127.0.0.1:4182/assets/audioExtractor-safe.js?token=private');
  emit('https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json?token=private');
  emit('https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx');
  emit('https://huggingface.co/onnx-community/whisper-base/resolve/main/generation_config.json', 'safe', undefined);
  emit('https://example.test/private-account?token=private');
  await capture.stop();
  assert.equal(bodies, 3);
  assert.equal(capture.receipt.assets.length, 4);
  assert.equal(capture.receipt.assets[2].hashState, 'body-not-read');
  assert.match(capture.receipt.assets[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(capture.receipt), /private|token|example|safe\"/);
});
test('disabled observation attaches no listeners; missing/large lengths never read bodies', async () => {
  const disabled = setup(false);
  assert.equal(disabled.page.listenerCount('response'), 0);
  const { page, capture } = setup();
  for (const length of [undefined, '999999999']) page.emit('response', { url: () => 'http://127.0.0.1:4182/assets/audioExtractor-ok.js', status: () => 200, headers: () => ({ 'content-length': length }), body: () => { throw Error('must not read'); } });
  await capture.stop();
  assert.deepEqual(capture.receipt.assets.map(asset => asset.hashState), ['missing-or-large-length', 'missing-or-large-length']);
});
