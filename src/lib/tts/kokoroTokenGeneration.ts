// Kokoro 1.2.1's generate() requests truncation. Validate the complete phoneme
// token sequence on a request-local facade before allowing model inference.
export const KOKORO_MAX_INPUT_TOKENS = 511;

type Ids = { dims: number[] };
type Options = { voice: string; speed: number };
export interface KokoroAudio {
  audio: Float32Array;
  sampling_rate: number;
  duration: number;
  toBlob(): Blob;
}
interface Engine {
  tokenizer: ((text: string, options: { truncation: boolean }) => { input_ids: Ids }) & { model_max_length?: number };
  _validate_voice(voice: string): unknown;
  generate(text: string, options: Options): Promise<unknown>;
  generate_from_ids(ids: Ids, options: Options): Promise<KokoroAudio>;
}
class TokenOverflow extends Error {}

export async function generateCompleteKokoroAudio(
  instance: unknown, text: string, options: Options, isCancelled: () => boolean = () => false,
): Promise<KokoroAudio> {
  const engine = instance as Engine;
  if (!engine || ['generate', '_validate_voice', 'tokenizer', 'generate_from_ids']
    .some(method => typeof engine[method as keyof Engine] !== 'function')) {
    throw new Error('Kokoro token protection requires the supported generation API');
  }
  const checkCancelled = () => {
    if (isCancelled()) throw new DOMException('Speech generation cancelled', 'AbortError');
  };
  const configuredLimit = Number(engine.tokenizer.model_max_length);
  const budget = Number.isFinite(configuredLimit) && configuredLimit > 2
    ? Math.min(KOKORO_MAX_INPUT_TOKENS, configuredLimit) : KOKORO_MAX_INPUT_TOKENS;
  const invoke = async (part: string, preflight: boolean) => {
    checkCancelled();
    let checkedIds: Ids | undefined;
    const facade = Object.create(engine);
    Object.defineProperties(facade, {
      _validate_voice: { value: engine._validate_voice.bind(engine) },
      tokenizer: { value: (phonemes: string) => {
        checkCancelled();
        const complete = engine.tokenizer(phonemes, { truncation: false });
        const tokens = complete?.input_ids?.dims?.at(-1);
        if (!Number.isInteger(tokens) || tokens < 2) throw new Error('Kokoro tokenizer returned an invalid input length');
        if (tokens > budget) throw new TokenOverflow(`Kokoro requires ${tokens} tokens; safe limit is ${budget}`);
        checkedIds = complete.input_ids;
        return complete;
      } },
      generate_from_ids: { value: (ids: Ids, settings: Options) => {
        checkCancelled();
        if (!checkedIds || ids !== checkedIds) throw new Error('Kokoro generation bypassed complete-token validation');
        return preflight ? undefined : engine.generate_from_ids(ids, settings);
      } },
    });
    const result = await engine.generate.call(facade, part, options);
    checkCancelled();
    if (!checkedIds) throw new Error('Kokoro generation bypassed complete-token validation');
    return result as KokoroAudio;
  };
  const fit = async (part: string): Promise<string[]> => {
    try {
      await invoke(part, true);
      return [part];
    } catch (error) {
      if (!(error instanceof TokenOverflow)) throw error;
      const sentences = Array.from(part.matchAll(/[.!?]["'”’)]*\s+/gu), m => m.index + m[0].length);
      const boundaries = sentences.length ? sentences : Array.from(part.matchAll(/\s+/gu), m => m.index + m[0].length);
      const valid = boundaries.filter(position => part.slice(0, position).trim() && part.slice(position).trim());
      if (!valid.length) throw new Error('Kokoro speech contains an unsplittable over-budget word');
      const midpoint = part.length / 2;
      const split = valid.reduce((best, next) => Math.abs(next - midpoint) < Math.abs(best - midpoint) ? next : best);
      return [...await fit(part.slice(0, split).trim()), ...await fit(part.slice(split).trim())];
    }
  };
  // Complete every preflight first: impossible input must never publish partial audio.
  const parts = await fit(text);
  const chunks: KokoroAudio[] = [];
  for (const part of parts) {
    const chunk = await invoke(part, false);
    if (!(chunk?.audio instanceof Float32Array) || !chunk.audio.length ||
      !Number.isFinite(chunk.sampling_rate) || chunk.sampling_rate <= 0 || typeof chunk.toBlob !== 'function') {
      throw new Error('Kokoro returned invalid audio');
    }
    if (chunks.length && chunk.sampling_rate !== chunks[0].sampling_rate) {
      throw new Error('Kokoro returned inconsistent sample rates');
    }
    chunks.push(chunk);
  }
  checkCancelled();
  const first = chunks[0];
  const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.audio.length, 0));
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk.audio, offset); offset += chunk.audio.length; }
  // Retain the installed RawAudio WAV encoder and its sample rate, with combined PCM.
  const combined = Object.create(first) as KokoroAudio;
  Object.defineProperties(combined, {
    audio: { value: samples },
    sampling_rate: { value: first.sampling_rate },
    duration: { value: samples.length / first.sampling_rate },
  });
  return combined;
}
