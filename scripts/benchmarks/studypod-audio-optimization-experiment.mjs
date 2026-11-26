import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { generateKokoroAudio, prepareKokoroSegments } from '../../backend/src/services/kokoroGenerationService.js';

// Same original 101-word sample and q8 CPU configuration as the earlier real benchmark.
const text = `A quiet morning begins with a small change in the light. The room warms gradually, and distant traffic becomes easier to hear. A kettle clicks off in the kitchen. Someone opens a notebook and writes down three questions for the day. None needs an immediate answer. The first concerns a task that has waited all week. The second is about a conversation that deserves more attention. The third is simply a reminder to take a short walk before lunch. Plans can change, but a clear first step makes it easier to begin. Progress is often the result of steady, ordinary effort.`;
const voice = process.env.STUDYPOD_TTS_VOICE || 'af_bella';
const outDir = path.resolve('.ai-bridge');
env.cacheDir = path.resolve('.cache/transformers');
env.allowRemoteModels = false;

let peakRss = process.memoryUsage().rss;
const sampleTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 40);

function inspectPcm(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Output is not RIFF/WAVE');
  let offset = 12, format = null, data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) throw new Error(`Truncated WAV chunk: ${id}`);
    if (id === 'fmt ' && size >= 16) format = { code: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    if (id === 'data') data = buffer.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!format || !data || !format.channels || !format.sampleRate || !format.bits) throw new Error('Missing WAV format or sample data');
  const width = format.bits / 8;
  if (![1, 2, 3, 4].includes(width)) throw new Error(`Unsupported WAV sample width: ${format.bits}`);
  let peak = 0, squares = 0, nonzero = 0, count = 0;
  for (let pos = 0; pos + width <= data.length; pos += width) {
    let value;
    if (format.code === 3 && width === 4) value = data.readFloatLE(pos);
    else if (format.code === 1 && width === 1) value = (data.readUInt8(pos) - 128) / 128;
    else if (format.code === 1 && width === 2) value = data.readInt16LE(pos) / 32768;
    else if (format.code === 1 && width === 3) value = data.readIntLE(pos, 3) / 8388608;
    else if (format.code === 1 && width === 4) value = data.readInt32LE(pos) / 2147483648;
    else throw new Error(`Unsupported WAV encoding: format=${format.code}, bits=${format.bits}`);
    if (!Number.isFinite(value)) throw new Error('Non-finite audio sample detected');
    const abs = Math.abs(value);
    if (abs > 0) nonzero++;
    if (abs > peak) peak = abs;
    squares += value * value;
    count++;
  }
  if (count === 0 || nonzero === 0 || !(peak > 0)) throw new Error('Audio waveform is empty or silent');
  return { seconds: +(count / format.channels / format.sampleRate).toFixed(3), channels: format.channels, sampleRate: format.sampleRate, bitsPerSample: format.bits, sampleCount: count, nonzeroSamples: nonzero, peakAbs: +peak.toFixed(6), rms: +Math.sqrt(squares / count).toFixed(6) };
}

async function synthesize(engine, segments, mode) {
  const start = performance.now();
  const generatePart = async (segment, index) => {
    const audio = await generateKokoroAudio(engine, segment.text, { voice, speed: 1 });
    const wavPath = path.join(outDir, `luna-audio-optimization-${mode}-part-${index + 1}.wav`);
    await audio.save(wavPath);
    const buffer = await readFile(wavPath);
    const waveform = inspectPcm(buffer);
    return { wavPath, bytes: (await stat(wavPath)).size, words: segment.text.split(/\s+/).length, waveform };
  };
  const parts = mode === 'serial'
    ? await (async () => { const items = []; for (const [index, segment] of segments.entries()) items.push(await generatePart(segment, index)); return items; })()
    : await Promise.all(segments.map(generatePart));
  const wallMs = performance.now() - start;
  const duration = parts.reduce((sum, part) => sum + part.waveform.seconds, 0);
  return { wallMs: +wallMs.toFixed(1), audioDurationSeconds: +duration.toFixed(3), realTimeFactor: +(wallMs / 1000 / duration).toFixed(3), bytes: parts.reduce((sum, part) => sum + part.bytes, 0), parts };
}

const loadStart = performance.now();
try {
  const engine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8', device: 'cpu' });
  const loadMs = +(performance.now() - loadStart).toFixed(1);
  const segments = await prepareKokoroSegments(engine, [{ text, speedMultiplier: 1 }], { voice });
  if (segments.length !== 2) throw new Error(`Expected the existing safe splitter to produce two parts; got ${segments.length}`);
  await mkdir(outDir, { recursive: true });
  const serial = await synthesize(engine, segments, 'serial');
  // Compare the same engine, voice, text, segment boundaries and order. Promise.all
  // bounds concurrency at two and starts only after serial synthesis has finished.
  const boundedConcurrent = await synthesize(engine, segments, 'concurrent-2');
  const ffprobe = (file) => {
    const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' });
    return result.status === 0 ? Number(result.stdout.trim()) : null;
  };
  for (const strategy of [serial, boundedConcurrent]) {
    for (const part of strategy.parts) {
      part.ffprobeSeconds = ffprobe(part.wavPath);
      if (part.ffprobeSeconds === null || Math.abs(part.ffprobeSeconds - part.waveform.seconds) > 0.02) throw new Error(`ffprobe verification failed for ${part.wavPath}`);
    }
  }
  const rss = +((Math.max(peakRss, process.memoryUsage().rss)) / 1024 / 1024).toFixed(1);
  const faster = boundedConcurrent.wallMs < serial.wallMs ? 'bounded-concurrency' : 'serial';
  const ratio = +(boundedConcurrent.wallMs / serial.wallMs).toFixed(3);
  const report = {
    benchmark: 'same-process real local Kokoro CPU serial vs bounded concurrency',
    runtime: process.version, model: 'onnx-community/Kokoro-82M-ONNX', dtype: 'q8', device: 'cpu', voice,
    wordCount: text.split(/\s+/).length, modelLoadMs: loadMs, segmentCount: segments.length,
    strategies: { serial, boundedConcurrent }, comparison: { faster, concurrentOverSerialRatio: ratio, peakProcessRssMiB: rss },
    checks: { allWaveformsFiniteAndNonempty: true, allFfprobeDurationsMatchPcmWithinMs: 20 },
    boundary: 'One sequential comparison on one machine/cache state. Waveform checks establish nonempty valid audio only; no listening or audible-quality claim. Previous run timings are not used as a paired baseline.'
  };
  const receipt = path.join(outDir, 'luna-audio-optimization-experiment.json');
  await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ receipt, ...report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.name, message: error.message, code: error.code || null }));
  process.exitCode = 1;
} finally {
  clearInterval(sampleTimer);
}
