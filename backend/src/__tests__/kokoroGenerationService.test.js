import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { createNarrationSignature } from '../services/audiobookDirectionService.js';
import {
  generateKokoroAudio,
  prepareKokoroSegments,
  KokoroTokenOverflowError,
} from '../services/kokoroGenerationService.js';

// Mirror installed Kokoro 1.2.1's public generate contract without inference.
const makeEngine = (count = (text) => text.length + 2) => {
  const tokenizer = vi.fn((text, { truncation }) => ({
    input_ids: { dims: [1, truncation ? Math.min(512, count(text)) : count(text)], text },
  }));
  tokenizer.model_max_length = 512;
  return {
    tokenizer,
    _validate_voice: vi.fn(() => 'a'),
    generate_from_ids: vi.fn(async (ids, options) => ({ ids, options })),
    async generate(text, { voice = 'af_heart', speed = 1 } = {}) {
      this._validate_voice(voice);
      const { input_ids } = this.tokenizer(text, { truncation: true });
      return this.generate_from_ids(input_ids, { voice, speed });
    },
  };
};
const words = (text) => text.trim().split(/\s+/u);

describe('Kokoro complete-token protection', () => {
  it('invalidates old Kokoro narration caches while preserving other providers', () => {
    const legacySignature = (provider) => crypto.createHash('sha256').update(JSON.stringify({
      version: 'v1', requestedPreset: 'faithful', resolvedPreset: 'faithful',
      pronunciations: [], voice: 'af_heart', provider,
    })).digest('hex').slice(0, 12);
    const signature = (provider) => createNarrationSignature({ requestedPreset: 'faithful', voice: 'af_heart', provider });
    expect(signature('kokoro')).not.toBe(legacySignature('kokoro'));
    expect(signature('kokoro')).toBe(signature('kokoro'));
    expect(signature('chatterbox')).toBe(legacySignature('chatterbox'));
  });

  it('passes complete ids at the 511-token safe boundary and preserves options', async () => {
    const engine = makeEngine(() => 511);
    const originalTokenizer = engine.tokenizer;
    const output = await generateKokoroAudio(engine, 'Complete narration.', { voice: 'af_bella', speed: 0.94 });
    expect(output.ids.dims).toEqual([1, 511]);
    expect(output.options).toEqual({ voice: 'af_bella', speed: 0.94 });
    expect(engine.tokenizer).toBe(originalTokenizer);
    expect(engine.tokenizer).toHaveBeenCalledWith('Complete narration.', { truncation: false });
  });

  it.each([512, 545])('rejects %i full tokens before inference rather than truncating', async (count) => {
    const engine = makeEngine(() => count);
    await expect(generateKokoroAudio(engine, 'Overflow.', { voice: 'af_heart' }))
      .rejects.toBeInstanceOf(KokoroTokenOverflowError);
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
  });

  it('honors a smaller configured tokenizer limit', async () => {
    const engine = makeEngine(() => 401);
    engine.tokenizer.model_max_length = 400;
    await expect(generateKokoroAudio(engine, 'Overflow.')).rejects.toThrow('safe limit is 400');
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
  });

  it('retains every Cedar word and the Researchers sentence after splitting its 545-token segment', async () => {
    const text = 'Chapter 1. Cedar experiment Synthetic StudyPod acceptance material. The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings. The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis. Plants use carbon dioxide and water to produce sugars and release oxygen. The experimental control receives the same water but no light. Researchers compare growth after fourteen days.';
    const engine = makeEngine((part) => part === text ? 545 : Math.ceil(part.length * 543 / text.length) + 2);
    const segments = await prepareKokoroSegments(engine, [{
      text, index: 0, pauseAfterMs: 350, speedMultiplier: 0.92, emphasis: 'faithful',
    }], { voice: 'af_heart' });
    expect(segments.length).toBeGreaterThan(1);
    expect(words(segments.map((segment) => segment.text).join(' '))).toEqual(words(text));
    expect(segments.some((segment) => segment.text.includes('Researchers compare growth after fourteen days.'))).toBe(true);
    expect(segments.map((segment) => segment.pauseAfterMs)).toEqual([0, 350]);
    expect(segments.every((segment) => segment.emphasis === 'faithful' && segment.speedMultiplier === 0.92)).toBe(true);
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
    for (const segment of segments) {
      const result = await generateKokoroAudio(engine, segment.text, { voice: 'af_heart', speed: segment.speedMultiplier });
      expect(result.ids.dims.at(-1)).toBeLessThanOrEqual(511);
    }
    expect(engine.generate_from_ids).toHaveBeenCalledTimes(segments.length);
  });

  it('splits a long sentence by word boundaries without changing spoken word order', async () => {
    const text = Array.from({ length: 180 }, (_, i) => `word${i}`).join(' ') + '.';
    const engine = makeEngine();
    const segments = await prepareKokoroSegments(engine, [{ text, pauseAfterMs: 100, speedMultiplier: 1 }]);
    expect(words(segments.map((segment) => segment.text).join(' '))).toEqual(words(text));
    expect(segments.every((segment) => segment.text.length + 2 <= 511)).toBe(true);
    expect(segments.slice(0, -1).every((segment) => segment.pauseAfterMs === 0)).toBe(true);
    expect(segments.at(-1).pauseAfterMs).toBe(100);
  });

  it('fails an unsplittable word before any chapter audio is synthesized', async () => {
    const engine = makeEngine();
    await expect(prepareKokoroSegments(engine, [
      { text: 'Fits.', pauseAfterMs: 0 },
      { text: 'a'.repeat(600), pauseAfterMs: 0 },
    ])).rejects.toThrow('unsplittable');
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
  });

  it('propagates voice and tokenizer failures rather than repeatedly splitting', async () => {
    const engine = makeEngine();
    engine._validate_voice.mockImplementation(() => { throw new Error('Unknown voice'); });
    await expect(prepareKokoroSegments(engine, [{ text: 'One. Two.' }])).rejects.toThrow('Unknown voice');
    expect(engine._validate_voice).toHaveBeenCalledTimes(1);
    const malformed = makeEngine(() => undefined);
    await expect(generateKokoroAudio(malformed, 'Text')).rejects.toThrow('invalid input length');
    expect(malformed.generate_from_ids).not.toHaveBeenCalled();
  });

  it('fails closed if the installed generation API bypasses validation', async () => {
    const engine = makeEngine();
    engine.generate = async function () { return this.generate_from_ids({ dims: [1, 3] }, {}); };
    await expect(generateKokoroAudio(engine, 'Text')).rejects.toThrow('bypassed');
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
  });

  it('isolates simultaneous request facades without mutating the shared tokenizer', async () => {
    const engine = makeEngine();
    const originalTokenizer = engine.tokenizer;
    const results = await Promise.all([
      generateKokoroAudio(engine, 'First request', { voice: 'af_heart', speed: 1 }),
      generateKokoroAudio(engine, 'Second request', { voice: 'af_bella', speed: 0.9 }),
    ]);
    expect(results.map((result) => result.ids.text)).toEqual(['First request', 'Second request']);
    expect(engine.tokenizer).toBe(originalTokenizer);
    expect(engine.tokenizer.mock.calls.every(([, options]) => options.truncation === false)).toBe(true);
  });
});
