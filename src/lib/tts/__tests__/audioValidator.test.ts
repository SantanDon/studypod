import { describe, test, expect } from 'vitest';
import { AudioValidator } from '../audioValidator';

function makeSilentWav(durationSec: number, sampleRate = 24000): Blob {
  const numSamples = Math.floor(sampleRate * durationSec);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

function makeNoiseWav(durationSec: number, sampleRate = 24000, amplitude = 0.1): Blob {
  const numSamples = Math.floor(sampleRate * durationSec);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(i * 0.01) * amplitude * 32767;
    view.setInt16(offset, sample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

describe('AudioValidator', () => {
  describe('validateBlob', () => {
    test('rejects null/empty blob', async () => {
      const result = await AudioValidator.validateBlob(new Blob([]));
      expect(result.valid).toBe(false);
      expect(result.hasSpeech).toBe(false);
    });

    test('rejects tiny blob that is not a valid WAV', async () => {
      const result = await AudioValidator.validateBlob(new Blob([1, 2, 3], { type: 'audio/wav' }));
      expect(result.valid).toBe(false);
    });

    test('detects silent WAV as not having speech', async () => {
      const silent = makeSilentWav(5);
      const result = await AudioValidator.validateBlob(silent);
      expect(result.hasSpeech).toBe(false);
      expect(result.rms).toBeLessThan(0.01);
      expect(result.silenceRatio).toBeGreaterThan(0.95);
    });

    test('detects noisy WAV and reports header info', async () => {
      const noise = makeNoiseWav(5, 24000, 0.1);
      const result = await AudioValidator.validateBlob(noise);
      // Header metadata always available (no AudioContext needed)
      expect(result.sampleRate).toBe(24000);
      expect(result.channels).toBe(1);
      expect(result.issues).not.toContain('Invalid RIFF header');
      // Full speech detection requires AudioContext (browser-only)
      // So hasSpeech may be false in Node test env — that is OK
    });

    test('returns valid header info for different sample rates', async () => {
      const noise = makeNoiseWav(3, 44100, 0.05);
      const result = await AudioValidator.validateBlob(noise);
      expect(result.sampleRate).toBe(44100);
      expect(result.channels).toBe(1);
      expect(result.issues).not.toContain('Invalid RIFF header');
    });
  });
});
