import { performance } from 'node:perf_hooks';
import { indexPodcastEvidence, compilePodcastEvidence } from '../../src/lib/audio/podcastEvidencePlan.ts';
import { prepareKokoroSegments } from '../../backend/src/services/kokoroGenerationService.js';

const rounds = Number(process.env.STUDYPOD_BENCH_ROUNDS || 9);
if (!Number.isInteger(rounds) || rounds < 3 || rounds > 50) throw new Error('STUDYPOD_BENCH_ROUNDS must be an integer from 3 to 50');

// Fixed, synthetic fixture: assembly and tokenizer-guard overhead only. This is not TTS.
const paragraph = 'The study reports a measured association in its selected sample. The authors describe limitations in the recruitment method and say the result does not establish causation.';
const source = Array.from({ length: 24 }, (_, i) => `[CHAPTER ${i + 1}]\n\n${paragraph}`).join('\n\n');
const indexed = indexPodcastEvidence(source, 12000);
const plan = JSON.stringify({ passageIds: indexed.passages.map(({ id }) => id) });
const episode = compilePodcastEvidence(plan, indexed.passages, 'Host A', 'Host B', false, 10000);
const segments = episode.segments.map((segment) => ({ ...segment, pauseAfterMs: 180 }));

// Mimics only the service contract. Token count is a deterministic approximation;
// generate_from_ids returns immediately and never synthesizes or writes audio.
const fakeEngine = {
  tokenizer: Object.assign((text) => ({ input_ids: { dims: [1, text.trim().split(/\s+/).filter(Boolean).length + 2] } }), { model_max_length: 511 }),
  _validate_voice() {},
  async generate(text) { return this.generate_from_ids(this.tokenizer(text).input_ids, {}); },
  async generate_from_ids(ids) { return ids.dims.at(-1); },
};

const measure = async (name, action) => {
  const samples = [];
  let result;
  for (let i = 0; i < rounds + 1; i++) {
    const start = performance.now();
    result = await action();
    const elapsed = performance.now() - start;
    if (i) samples.push(elapsed); // discard one warm-up
  }
  samples.sort((a, b) => a - b);
  const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
  return { name, p50Ms: +percentile(0.5).toFixed(3), p95Ms: +percentile(0.95).toFixed(3), samples: samples.length, result };
};

const evidence = await measure('evidence-index-and-episode-assembly', () => {
  const doc = indexPodcastEvidence(source, 12000);
  return compilePodcastEvidence(plan, doc.passages, 'Host A', 'Host B', false, 10000);
});
const preflight = await measure('kokoro-segment-preflight-with-immediate-mock-engine', () => prepareKokoroSegments(fakeEngine, segments, { voice: 'mock' }));

if (evidence.result.segments.filter((s) => indexed.passages.some((p) => p.text === s.text)).length !== indexed.passages.length) throw new Error('Evidence fidelity invariant failed');
if (preflight.result.length !== segments.length || preflight.result.some((s, i) => s.text !== segments[i].text || s.index !== i)) throw new Error('Segment preflight invariant failed');

console.log(JSON.stringify({
  benchmark: 'StudyPod audio CPU orchestration/assembly only',
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  rounds,
  fixture: { sourcePassages: indexed.passages.length, sourceChars: indexed.budgetedChars, episodeWords: episode.words, inputSegments: segments.length },
  measurements: [evidence, preflight].map(({ result, ...timing }) => timing),
  checks: { sourcePassagesPreservedLiterally: true, segmentOrderAndIndicesPreserved: true },
  boundary: 'No model, network, audio synthesis, playback, or file output. Timings exclude real tokenization and TTS; mock tokenizer is word-count based.',
}, null, 2));
