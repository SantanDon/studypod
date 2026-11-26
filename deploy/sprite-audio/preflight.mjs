import { execFileSync } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { KokoroTTS } from 'kokoro-js';

execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
const start = performance.now();
const engine = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});
const speech = await engine.generate('A source citation takes you to the original passage.', {
  voice: 'af_heart',
});
if (!speech.audio?.length || !speech.sampling_rate || !speech.audio.some(sample => Math.abs(sample) > 0.001)) {
  throw new Error('Kokoro returned no audible samples.');
}
console.log(JSON.stringify({
  cpuCount: availableParallelism(),
  hostMemoryMiB: Math.round(totalmem() / 1024 ** 2),
  peakRendererMiB: Math.ceil(process.resourceUsage().maxRSS / 1024),
  audioSeconds: Number((speech.audio.length / speech.sampling_rate).toFixed(2)),
  elapsedSeconds: Number(((performance.now() - start) / 1000).toFixed(2)),
}));
