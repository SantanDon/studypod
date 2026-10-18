import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedAudioPolicy } from './shared-account-audio-policy.mjs';
const origin = 'http://localhost:4182';
function ready() {
  const p = createSharedAudioPolicy(origin);
  p.verifyIdentity();
  assert.equal(p.decide(origin + '/api/notebooks', 'POST').captureCreated, true);
  p.registerCreated('own-audio-notebook');
  return p;
}
test('external model downloads require verified identity and captured new notebook', () => {
  const p = createSharedAudioPolicy(origin);
  const asset = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8.onnx';
  assert.equal(p.decide(asset, 'GET').allowed, false);
  p.verifyIdentity();
  assert.equal(p.decide(asset, 'GET').allowed, false);
  p.decide(origin + '/api/notebooks', 'POST'); p.registerCreated('own-audio-notebook');
  assert.equal(p.decide(asset, 'GET').allowed, true);
});
test('audio download exception stays read-only, asset-only, known-host-only', () => {
  const p = ready();
  for (const url of [
    'https://huggingface.co/repo/config.json',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    'https://huggingface.co/repo/voices/af_heart.bin',
    'https://cas-bridge.xethub.hf.co/repo/model.onnx',
  ]) assert.equal(p.decide(url, 'GET').allowed, true, url);
  for (const url of [
    'https://unknown.example/model.onnx',
    'https://huggingface.co.evil.example/model.onnx',
    'https://user:secret@huggingface.co/model.onnx',
    'http://huggingface.co/model.onnx',
    'https://huggingface.co/api/whoami',
    'https://huggingface.co/collect.js',
    'https://cdn.jsdelivr.net/config.json.exe',
  ]) assert.equal(p.decide(url, 'GET').allowed, false, url);
  for (const method of ['POST','PUT','DELETE','PATCH']) assert.equal(p.decide('https://huggingface.co/model.onnx', method).allowed, false);
});
test('audio exceptions preserve unrelated-notebook denial and encrypted sync quarantine', () => {
  const p = ready();
  assert.equal(p.decide(origin + '/api/notebooks/existing-notebook/studio/podcasts', 'POST').allowed, false);
  assert.equal(p.decide(origin + '/api/notebooks/own-audio-notebook/studio/podcasts', 'POST').allowed, true);
  assert.deepEqual(p.decide(origin + '/api/sync/upload', 'POST'), {allowed:false,reason:'encrypted-background-sync-quarantined',quarantined:true});
});
