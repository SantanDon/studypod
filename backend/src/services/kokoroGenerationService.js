// Kokoro 1.2.1 silently truncates phonemes in generate(). Keep complete input ids
// within the 509 content positions supported by its voice style table, plus BOS/EOS.
export const KOKORO_MAX_INPUT_TOKENS = 511;
export const KOKORO_TOKEN_BUDGET_VERSION = 'tokens-v1';

export class KokoroTokenOverflowError extends Error {
  constructor(tokens, budget) {
    super(`Kokoro narration requires ${tokens} tokens; safe limit is ${budget}`);
    this.name = 'KokoroTokenOverflowError';
    this.code = 'KOKORO_TOKEN_OVERFLOW';
  }
}

const invokeGuarded = async (engine, text, options, { preflight = false } = {}) => {
  if (!engine || ['generate', '_validate_voice', 'tokenizer', 'generate_from_ids']
    .some((method) => typeof engine[method] !== 'function')) {
    throw new Error('Kokoro token protection requires the supported generation API');
  }
  const configuredLimit = Number(engine.tokenizer.model_max_length);
  const budget = Number.isFinite(configuredLimit) && configuredLimit > 2
    ? Math.min(KOKORO_MAX_INPUT_TOKENS, configuredLimit)
    : KOKORO_MAX_INPUT_TOKENS;
  let checkedIds;
  // Never replace the shared engine's tokenizer: concurrent requests each get
  // their own facade, while using the exact installed voice/phonemization path.
  const facade = Object.create(engine);
  Object.defineProperties(facade, {
    _validate_voice: { value: engine._validate_voice.bind(engine) },
    tokenizer: { value: (phonemes) => {
      const complete = engine.tokenizer(phonemes, { truncation: false });
      const tokens = complete?.input_ids?.dims?.at(-1);
      if (!Number.isInteger(tokens) || tokens < 2) {
        throw new Error('Kokoro tokenizer returned an invalid input length');
      }
      if (tokens > budget) throw new KokoroTokenOverflowError(tokens, budget);
      checkedIds = complete.input_ids;
      return complete;
    } },
    generate_from_ids: { value: (ids, generationOptions) => {
      if (!checkedIds || ids !== checkedIds) {
        throw new Error('Kokoro generation bypassed complete-token validation');
      }
      return preflight ? ids.dims.at(-1) : engine.generate_from_ids(ids, generationOptions);
    } },
  });
  const result = await engine.generate.call(facade, text, options);
  if (!checkedIds) throw new Error('Kokoro generation bypassed complete-token validation');
  return result;
};

export const generateKokoroAudio = (engine, text, options) =>
  invokeGuarded(engine, text, options);

const splitText = (text) => {
  const midpoint = text.length / 2;
  const sentences = Array.from(text.matchAll(/[.!?]["'”’)]*\s+/gu),
    (match) => match.index + match[0].length);
  const words = sentences.length ? sentences
    : Array.from(text.matchAll(/\s+/gu), (match) => match.index + match[0].length);
  const positions = words.filter((position) =>
    text.slice(0, position).trim() && text.slice(position).trim());
  if (!positions.length) throw new Error('Kokoro narration contains an unsplittable over-budget word');
  const position = positions.reduce((best, next) =>
    Math.abs(next - midpoint) < Math.abs(best - midpoint) ? next : best);
  return [text.slice(0, position).trim(), text.slice(position).trim()];
};

// Finish all preflight checks before synthesis starts, so an unsplittable word
// cannot leave a partially rendered chapter. Only final pieces keep the pause.
export const prepareKokoroSegments = async (engine, segments, { voice } = {}) => {
  const fit = async (text, options) => {
    try {
      await invokeGuarded(engine, text, options, { preflight: true });
      return [text];
    } catch (error) {
      if (!(error instanceof KokoroTokenOverflowError)) throw error;
      const [left, right] = splitText(text);
      return [...await fit(left, options), ...await fit(right, options)];
    }
  };
  const prepared = [];
  for (const segment of segments) {
    const pieces = await fit(segment.text, { voice, speed: segment.speedMultiplier });
    pieces.forEach((text, index) => prepared.push({
      ...segment,
      text,
      index: prepared.length,
      pauseAfterMs: index === pieces.length - 1 ? segment.pauseAfterMs : 0,
    }));
  }
  return prepared;
};
