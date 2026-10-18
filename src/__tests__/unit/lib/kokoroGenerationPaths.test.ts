import { afterEach, describe, expect, it, vi } from 'vitest';

const { engine, infer } = vi.hoisted(() => {
  const infer = vi.fn();
  return {
    infer,
    engine: {
      _validate_voice: () => 'a',
      tokenizer: (text: string, { truncation }: { truncation: boolean }) => ({
        input_ids: { dims: [1, truncation ? Math.min(512, text.length + 2) : text.length + 2] },
      }),
      generate_from_ids: infer,
      async generate(text: string, options: { voice: string; speed: number }) {
        this._validate_voice();
        const { input_ids } = this.tokenizer(text, { truncation: true });
        return this.generate_from_ids(input_ids, options);
      },
    },
  };
});
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn(async () => engine) } }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); infer.mockClear(); });

describe('browser Kokoro generation entry points', () => {
  it('standard and premium providers reject unsplittable overflow before inference or audio URLs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { KokoroTTSProvider } = await import('@/lib/tts/kokoroTTSProvider');
    const { KokoroPremiumTTSProvider } = await import('@/lib/tts/kokoroPremiumTTSProvider');
    for (const provider of [new KokoroTTSProvider(), new KokoroPremiumTTSProvider()]) {
      await expect(provider.synthesize({ text: 'a'.repeat(600), voice: 'af_heart', speed: 1 }))
        .rejects.toThrow('unsplittable');
    }
    expect(infer).not.toHaveBeenCalled();
  });

  it('worker responds with an error and never publishes audio for unsplittable overflow', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const postMessage = vi.fn();
    const worker = { postMessage, onmessage: undefined as undefined | ((event: { data: object }) => Promise<void>) };
    vi.stubGlobal('self', worker);
    await import('@/lib/tts/ttsWorkerScript');
    await worker.onmessage!({ data: { type: 'init' } });
    await worker.onmessage!({ data: { type: 'synthesize', id: 'overflow', text: 'a'.repeat(600), voice: 'af_heart' } });
    expect(postMessage.mock.calls.some(([message]) => message.type === 'error' && message.id === 'overflow' && message.message.includes('unsplittable'))).toBe(true);
    expect(postMessage.mock.calls.some(([message]) => message.type === 'audio')).toBe(false);
    expect(infer).not.toHaveBeenCalled();
  });
});
