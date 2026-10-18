import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseAudioPcm, wavPcmReference } from './audio-pcm-diagnostic.mjs';

const samples = [0, 16384, -16384, 32767, -32768];
function wav() {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => bytes.writeInt16LE(value, 44 + index * 2));
  return bytes;
}

test('disabled means no file read or browser work', async () => {
  assert.deepEqual(await diagnoseAudioPcm({ evaluate() { throw Error('must not execute'); } }, 'missing'), { enabled: false });
});

test('PCM16 reference uses deterministic little-endian float values and rejects malformed data', () => {
  const expected = Buffer.alloc(samples.length * 4);
  samples.forEach((value, index) => expected.writeFloatLE(value / 32768, index * 4));
  const reference = wavPcmReference(wav());
  assert.equal(reference.nativeFloat32Sha256, createHash('sha256').update(expected).digest('hex'));
  assert.equal(reference.frameCount, samples.length);
  assert.equal(reference.sampleRate, 16000);
  assert.equal(wavPcmReference(wav().subarray(0, 45)).status, 'invalid-wav');
  assert.equal(wavPcmReference(Buffer.alloc(8 * 1024 * 1024 + 1)).status, 'fixture-size-rejected');
});

test('synthetic browser success and failure close AudioContext and retain only safe fields', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'studypod-pcm-control-'));
  const file = join(folder, 'private-account-fixture.wav');
  const original = globalThis.AudioContext;
  let closed = 0;
  let fail = false;
  globalThis.AudioContext = class {
    constructor({ sampleRate }) { this.sampleRate = sampleRate; }
    async decodeAudioData() {
      if (fail) throw Error('private-account-token');
      return { length: samples.length, numberOfChannels: 1, sampleRate: 16000, duration: samples.length / 16000,
        getChannelData: () => Float32Array.from(samples, value => value / 32768) };
    }
    async close() { closed++; }
  };
  try {
    await writeFile(file, wav());
    const page = { evaluate: (callback, args) => callback(args) };
    const receipt = await diagnoseAudioPcm(page, file, { enabled: true });
    assert.equal(receipt.status, 'ok');
    assert.equal(receipt.decoded.monoFloat32Sha256, receipt.reference.nativeFloat32Sha256);
    assert.equal(receipt.decoded.nonFiniteCount, 0);
    assert.equal(closed, 1);
    fail = true;
    const failed = await diagnoseAudioPcm(page, file, { enabled: true });
    assert.equal(failed.status, 'decode-or-hash-failed');
    assert.equal(closed, 2);
    const output = JSON.stringify([receipt, failed]);
    for (const forbidden of [file, 'private-account', 'base64', wav().toString('base64')]) assert.equal(output.includes(forbidden), false);
    assert.deepEqual(await diagnoseAudioPcm(page, file, { enabled: true, sampleRate: 1 }), { enabled: true, status: 'invalid-sample-rate' });
  } finally {
    if (original === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = original;
    await unlink(file); await rmdir(folder);
  }
});
