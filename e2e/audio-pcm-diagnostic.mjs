import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const MAX_BYTES = 8 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Native PCM reference only: no substitute resampler or inference is introduced.
export function wavPcmReference(bytes) {
  if (bytes.length > MAX_BYTES) return { status: 'fixture-size-rejected' };
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return { status: 'unsupported-wav' };
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) return { status: 'invalid-wav' };
    const id = bytes.toString('ascii', offset, offset + 4);
    if (id === 'fmt ' && size >= 16) format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), bitsPerSample: bytes.readUInt16LE(start + 14) };
    if (id === 'data') data = bytes.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || format.bitsPerSample !== 16 || format.channels !== 1 || !format.sampleRate || data.length % 2) return { status: 'unsupported-pcm' };
  const pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length / 2; i++) pcm.writeFloatLE(data.readInt16LE(i * 2) / 32768, i * 4);
  return { status: 'ok', channels: 1, sampleRate: format.sampleRate, bitsPerSample: 16, frameCount: data.length / 2, durationSeconds: data.length / 2 / format.sampleRate, sourcePcmSha256: sha256(data), nativeFloat32Sha256: sha256(pcm) };
}

export async function diagnoseAudioPcm(page, fixtureWav, { enabled = false, sampleRate = 16000 } = {}) {
  if (!enabled) return { enabled: false };
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return { enabled: true, status: 'invalid-sample-rate' };
  try {
    const info = await stat(fixtureWav);
    if (!info.isFile() || info.size > MAX_BYTES) return { enabled: true, status: 'fixture-size-rejected' };
    const bytes = await readFile(fixtureWav);
    if (bytes.length > MAX_BYTES) return { enabled: true, status: 'fixture-size-rejected' };
    const reference = wavPcmReference(bytes);
    if (reference.status !== 'ok') return { enabled: true, status: reference.status };
    const decoded = await page.evaluate(async ({ base64, requestedRate }) => {
      let context;
      const bounded = async (promise, ms) => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]); }
        finally { clearTimeout(timer); }
      };
      try {
        if (typeof AudioContext === 'undefined') return { status: 'audio-context-unavailable' };
        context = new AudioContext({ sampleRate: requestedRate });
        const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const audio = await bounded(context.decodeAudioData(raw.buffer), 15000);
        if (audio.length > 4000000 || audio.numberOfChannels < 1 || audio.numberOfChannels > 2) return { status: 'decoded-size-or-channels-rejected' };
        const left = audio.getChannelData(0);
        const right = audio.numberOfChannels === 2 ? audio.getChannelData(1) : null;
        const pcm = new DataView(new ArrayBuffer(audio.length * 4));
        let nonFiniteCount = 0, clippedCount = 0, sumSquares = 0, peak = 0;
        for (let i = 0; i < audio.length; i++) {
          const value = right ? Math.fround(Math.sqrt(2) * (left[i] + right[i]) / 2) : left[i];
          pcm.setFloat32(i * 4, value, true);
          if (!Number.isFinite(value)) { nonFiniteCount++; continue; }
          if (Math.abs(value) >= 1) clippedCount++;
          peak = Math.max(peak, Math.abs(value)); sumSquares += value * value;
        }
        const digest = await crypto.subtle.digest('SHA-256', pcm.buffer);
        return { status: 'ok', requestedSampleRate: requestedRate, contextSampleRate: context.sampleRate, decodedSampleRate: audio.sampleRate, decodedChannels: audio.numberOfChannels, frameCount: audio.length, durationSeconds: audio.duration, nonFiniteCount, clippedCount, peak, rms: Math.sqrt(sumSquares / Math.max(audio.length, 1)), monoFloat32Sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
      } catch { return { status: 'decode-or-hash-failed' }; }
      finally { if (context) { try { await bounded(context.close(), 1000); } catch { /* No raw browser error retained. */ } } }
    }, { base64: bytes.toString('base64'), requestedRate: sampleRate });
    return { enabled: true, status: decoded.status, fixtureByteLength: bytes.length, fixtureSha256: sha256(bytes), reference, decoded };
  } catch { return { enabled: true, status: 'fixture-or-browser-failed' }; }
}
