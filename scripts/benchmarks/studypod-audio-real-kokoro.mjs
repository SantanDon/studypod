import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { generateKokoroAudio, prepareKokoroSegments } from '../../backend/src/services/kokoroGenerationService.js';

// Original benchmark-only prose (101 words); no source claims.
const text = `A quiet morning begins with a small change in the light. The room warms gradually, and distant traffic becomes easier to hear. A kettle clicks off in the kitchen. Someone opens a notebook and writes down three questions for the day. None needs an immediate answer. The first concerns a task that has waited all week. The second is about a conversation that deserves more attention. The third is simply a reminder to take a short walk before lunch. Plans can change, but a clear first step makes it easier to begin. Progress is often the result of steady, ordinary effort.`;
const voice = process.env.STUDYPOD_TTS_VOICE || 'af_bella';
const outDir = path.resolve('.ai-bridge');

// Explicitly prohibit remote model access: this script must never download weights.
env.cacheDir = path.resolve('.cache/transformers');
env.allowRemoteModels = false;

let peakRss = process.memoryUsage().rss;
const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
const loadStart = performance.now();
try {
  const engine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'q8', device: 'cpu' });
  const loadMs = performance.now() - loadStart;
  // Use the exact product preflight splitter; Kokoro's phoneme/token count is
  // not proportional to whitespace words and this passage may need splitting.
  const segments = await prepareKokoroSegments(engine, [{ text, speedMultiplier: 1 }], { voice });
  await mkdir(outDir, { recursive: true });
  const synthesisStart = performance.now();
  const parts = [];
  for (const [index, segment] of segments.entries()) {
    const audio = await generateKokoroAudio(engine, segment.text, { voice, speed: 1 });
    const wavPath = path.join(outDir, `luna-audio-real-benchmark-part-${index + 1}.wav`);
    await audio.save(wavPath);
    parts.push({ wavPath, textWords: segment.text.split(/\s+/).length, wavBytes: (await stat(wavPath)).size });
  }
  const synthMs = performance.now() - synthesisStart;
  const probeDuration = async (wavPath) => {
    const ffprobe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', wavPath], { encoding: 'utf8' });
    if (ffprobe.status === 0) return { seconds: Number(ffprobe.stdout.trim()), available: true };
    const wav = await readFile(wavPath);
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Output failed RIFF/WAVE probe: ${wavPath}`);
    let offset = 12, byteRate = 0, dataBytes = 0;
    while (offset + 8 <= wav.length) {
      const id = wav.toString('ascii', offset, offset + 4), length = wav.readUInt32LE(offset + 4), body = offset + 8;
      if (id === 'fmt ' && length >= 16) byteRate = wav.readUInt32LE(body + 8);
      if (id === 'data') dataBytes = length;
      offset = body + length + (length % 2);
    }
    if (!byteRate || !dataBytes) throw new Error(`WAV duration unavailable: ${wavPath}`);
    return { seconds: dataBytes / byteRate, available: false };
  };
  for (const part of parts) part.probe = await probeDuration(part.wavPath);
  const durationSeconds = parts.reduce((total, part) => total + part.probe.seconds, 0);
  const peakFinalRss = Math.max(peakRss, process.memoryUsage().rss);
  if (!(durationSeconds > 0) || parts.some((part) => !(part.probe.seconds > 0))) throw new Error('WAV duration probe failed');
  const result = {
    benchmark: 'real local Kokoro CPU synthesis', runtime: process.version,
    model: 'onnx-community/Kokoro-82M-ONNX', dtype: 'q8', device: 'cpu', voice,
    wordCount: text.split(/\s+/).length, loadMs: +loadMs.toFixed(1),
    segmentCount: parts.length, synthesisWallMs: +synthMs.toFixed(1),
    audioDurationSeconds: +durationSeconds.toFixed(3), realTimeFactor: +(synthMs / 1000 / durationSeconds).toFixed(3),
    wavBytes: parts.reduce((sum, part) => sum + part.wavBytes, 0), parts, processRssPeakMiB: +(peakFinalRss / 1024 / 1024).toFixed(1),
    ffprobe: parts.every((part) => part.probe.available),
    boundary: 'One local synthesis run only. No listening or audible quality assessment was performed.',
  };
  await writeFile(path.join(outDir, 'luna-audio-real-benchmark.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.name, message: error.message, code: error.code || null }));
  process.exitCode = 1;
} finally {
  clearInterval(sample);
}
