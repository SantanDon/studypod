import { describe, expect, it, vi } from 'vitest';
import { generateCompleteKokoroAudio } from '@/lib/tts/kokoroTokenGeneration';

const options = { voice: 'af_heart', speed: 0.92 };
const makeEngine = (count = (text: string) => text.length + 2) => {
  const tokenizer = Object.assign(vi.fn((text: string, { truncation }: { truncation: boolean }) => ({
    input_ids: { dims: [1, truncation ? Math.min(512, count(text)) : count(text)], text },
  })), { model_max_length: 512 });
  return {
    tokenizer,
    _validate_voice: vi.fn(() => 'a'),
    generate_from_ids: vi.fn(async (ids: { text: string }, settings: typeof options) => ({
      audio: new Float32Array([ids.text.length, settings.speed]), sampling_rate: 24000,
      toBlob() { return new Blob([this.audio], { type: 'audio/wav' }); },
    })),
    async generate(text: string, settings: typeof options) {
      this._validate_voice(settings.voice);
      const { input_ids } = this.tokenizer(text, { truncation: true });
      return this.generate_from_ids(input_ids, settings);
    },
  };
};
const words = (text: string) => text.trim().split(/\s+/u);

describe('browser Kokoro complete-token generation', () => {
  it('uses complete tokens at the safe 511 boundary without changing the shared tokenizer', async () => {
    const engine = makeEngine(() => 511);
    const tokenizer = engine.tokenizer;
    const audio = await generateCompleteKokoroAudio(engine, 'All words.', options);
    expect(engine.tokenizer).toBe(tokenizer);
    expect(tokenizer.mock.calls.every(([, settings]) => !settings.truncation)).toBe(true);
    expect(engine.generate_from_ids).toHaveBeenCalledTimes(1);
    expect(engine.generate_from_ids.mock.calls[0][1]).toEqual(options);
    expect(audio.duration).toBe(2 / 24000);
  });

  it('retains the exact 545-token Cedar Researchers sentence and concatenates every PCM chunk in order', async () => {
    const text = 'Chapter 1. Cedar experiment Synthetic StudyPod acceptance material. The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings. The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis. Plants use carbon dioxide and water to produce sugars and release oxygen. The experimental control receives the same water but no light. Researchers compare growth after fourteen days.';
    const engine = makeEngine(part => part === text ? 545 : Math.ceil(part.length * 543 / text.length) + 2);
    const audio = await generateCompleteKokoroAudio(engine, text, options);
    const calls = engine.generate_from_ids.mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(words(calls.map(([ids]) => ids.text).join(' '))).toEqual(words(text));
    expect(calls.some(([ids]) => ids.text.includes('Researchers compare growth after fourteen days.'))).toBe(true);
    expect(calls.every(([ids]) => engine.tokenizer(ids.text, { truncation: false }).input_ids.dims[1] <= 511)).toBe(true);
    expect(Array.from(audio.audio)).toEqual(calls.flatMap(([ids]) => [ids.text.length, Math.fround(options.speed)]));
    expect(audio.sampling_rate).toBe(24000);
    expect(audio.duration).toBe(calls.length * 2 / 24000);
    expect(audio.toBlob().size).toBe(audio.audio.byteLength);
  });

  it('splits oversized sentences at whitespace and honors smaller configured limits', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const engine = makeEngine();
    engine.tokenizer.model_max_length = 100;
    await generateCompleteKokoroAudio(engine, text, options);
    const parts = engine.generate_from_ids.mock.calls.map(([ids]) => ids.text);
    expect(words(parts.join(' '))).toEqual(words(text));
    expect(parts.every(part => part.length + 2 <= 100)).toBe(true);
  });

  it('fails closed before any inference for an unsplittable overflow word', async () => {
    const engine = makeEngine();
    await expect(generateCompleteKokoroAudio(engine, 'Fits. ' + 'a'.repeat(600), options)).rejects.toThrow('unsplittable');
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
  });

  it('stops after cancellation during inference without producing further chunks', async () => {
    const engine = makeEngine();
    let cancelled = false;
    const generate = engine.generate_from_ids.getMockImplementation()!;
    engine.generate_from_ids.mockImplementation(async (...args) => {
      const result = await generate(...args);
      cancelled = true;
      return result;
    });
    await expect(generateCompleteKokoroAudio(engine, 'word '.repeat(150), options, () => cancelled)).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.generate_from_ids).toHaveBeenCalledTimes(1);
  });

  it('rejects cancellation before preflight and rejects mismatched sample rates', async () => {
    const engine = makeEngine();
    await expect(generateCompleteKokoroAudio(engine, 'Text', options, () => true)).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.tokenizer).not.toHaveBeenCalled();
    const generate = engine.generate_from_ids.getMockImplementation()!;
    engine.generate_from_ids.mockImplementation(async (...args) => ({
      ...await generate(...args), sampling_rate: engine.generate_from_ids.mock.calls.length === 1 ? 24000 : 16000,
    }));
    await expect(generateCompleteKokoroAudio(engine, 'word '.repeat(150), options)).rejects.toThrow('inconsistent sample rates');
  });

  it('propagates provider errors and rejects changed APIs that bypass validation', async () => {
    const engine = makeEngine();
    engine._validate_voice.mockImplementation(() => { throw new Error('Unknown voice'); });
    await expect(generateCompleteKokoroAudio(engine, 'One. Two.', options)).rejects.toThrow('Unknown voice');
    expect(engine.generate_from_ids).not.toHaveBeenCalled();
    const bypass = makeEngine();
    bypass.generate = async function (_text, settings) { return this.generate_from_ids({ text: 'unchecked' }, settings); };
    await expect(generateCompleteKokoroAudio(bypass, 'Text', options)).rejects.toThrow('bypassed');
    expect(bypass.generate_from_ids).not.toHaveBeenCalled();
  });

  it('isolates concurrent requests and preserves each voice and speed', async () => {
    const engine = makeEngine();
    const tokenizer = engine.tokenizer;
    await Promise.all([
      generateCompleteKokoroAudio(engine, 'First request', options),
      generateCompleteKokoroAudio(engine, 'Second request', { voice: 'am_onyx', speed: 1.1 }),
    ]);
    expect(engine.tokenizer).toBe(tokenizer);
    expect(engine.generate_from_ids.mock.calls.map(([ids, settings]) => [ids.text, settings.voice])).toEqual([
      ['First request', 'af_heart'], ['Second request', 'am_onyx'],
    ]);
  });
});
