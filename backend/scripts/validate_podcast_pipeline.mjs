/**
 * validate_podcast_pipeline.mjs
 * Brief end-to-end validation of the podcast audio pipeline.
 *
 * Usage:
 *   node backend/scripts/validate_podcast_pipeline.mjs
 *
 * This script:
 *   1. Generates a brief test podcast script (2-3 min)
 *   2. Runs it through Kokoro TTS
 *   3. Validates the output WAV for speech content
 *   4. Reports pass/fail with diagnostics
 */

import { KokoroTTS } from 'kokoro-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', '..', 'uploads', 'test_output');

// ---- Helpers ----

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeWav(filename, blob) {
  const filepath = join(OUTPUT_DIR, filename);
  // Convert Blob to Buffer (works in Node.js with kokoro-js)
  blob.arrayBuffer().then(buf => {
    writeFileSync(filepath, Buffer.from(buf));
    console.log(`  📁 Wrote ${filepath} (${buf.byteLength} bytes)`);
  });
}

// ---- Validators ----

function validateWavHeader(buffer) {
  const view = new DataView(buffer);
  const issues = [];

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') issues.push(`Bad RIFF: "${riff}"`);

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') issues.push(`Bad WAVE: "${wave}"`);

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Find data chunk size
  let offset = 12;
  let dataSize = 0;
  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') { dataSize = chunkSize; break; }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }

  const expectedDataSize = buffer.byteLength - 44;
  if (dataSize !== expectedDataSize) issues.push(`Data chunk size mismatch: ${dataSize} vs expected ${expectedDataSize}`);

  const sampleCount = dataSize / (channels * (bitsPerSample / 8));
  const duration = sampleCount / sampleRate;

  // Check for silence
  let maxSample = 0;
  let silentSamples = 0;
  const dataStart = offset + 8;
  for (let i = dataStart; i < buffer.byteLength - 1; i += 2) {
    const sample = Math.abs(view.getInt16(i, true));
    if (sample > maxSample) maxSample = sample;
    if (sample < 80) silentSamples++;  // ~0.5% of 16-bit range
  }

  const totalSamples = (buffer.byteLength - dataStart) / 2;
  const silenceRatio = totalSamples > 0 ? silentSamples / totalSamples : 1;
  const rms = maxSample / 32768;

  const hasSpeech = rms > 0.02 && duration > 2 && silenceRatio < 0.95;

  return { valid: issues.length === 0 && hasSpeech, duration, sampleRate, channels, rms, silenceRatio, maxSample, issues, hasSpeech };
}

// ---- Main ----

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  StudyPodLM — Podcast Pipeline Validator');
  console.log('═══════════════════════════════════════════');
  console.log('');

  ensureDir(OUTPUT_DIR);

  // Step 1: Test voices
  console.log('📢 Step 1: Testing Kokoro voices...');
  let kokoro;
  try {
    kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'fp32',
      device: 'cpu',
    });
    console.log('  ✅ Kokoro TTS initialized');
  } catch (e) {
    console.error('  ❌ Failed to initialize Kokoro:', e.message);
    process.exit(1);
  }

  // Step 2: Generate test phrases with different voices
  console.log('');
  console.log('📢 Step 2: Generating test audio segments...');

  const testPhrases = [
    { voice: 'am_onyx', text: 'Welcome to our podcast. Today we are discussing a fascinating topic.' },
    { voice: 'af_nova', text: 'That is a great question. Let me explain how this works in practice.' },
    { voice: 'am_onyx', text: 'This is really important for understanding the bigger picture.' },
    { voice: 'af_nova', text: 'I can see why this concept matters so much for learners.' },
  ];

  const segments = [];
  for (const [i, phrase] of testPhrases.entries()) {
    console.log(`  Generating segment ${i + 1}/${testPhrases.length} (${phrase.voice})...`);
    try {
      const audio = await kokoro.generate(phrase.text, { voice: phrase.voice, speed: 0.9 });
      const blob = await audio.toBlob();
      segments.push({ ...phrase, blob, duration: audio.duration });
      console.log(`    ✅ ${(audio.duration || 0).toFixed(1)}s, ${blob.size} bytes`);

      // Write individual segment
      const buf = await blob.arrayBuffer();
      writeFileSync(join(OUTPUT_DIR, `segment_${i}_${phrase.voice.replace('.', '_')}.wav`), Buffer.from(buf));
    } catch (e) {
      console.error(`    ❌ Failed: ${e.message}`);
    }
  }

  if (segments.length === 0) {
    console.error('  ❌ No segments generated!');
    process.exit(1);
  }

  // Step 3: Validate each segment
  console.log('');
  console.log('📢 Step 3: Validating individual segments...');

  let allValid = true;
  for (const [i, seg] of segments.entries()) {
    const buf = await seg.blob.arrayBuffer();
    const result = validateWavHeader(buf);
    const status = result.hasSpeech ? '✅' : '❌';
    console.log(`  ${status} Segment ${i + 1} (${seg.voice}): ${result.duration.toFixed(1)}s, RMS=${result.rms.toFixed(4)}, silence=${(result.silenceRatio * 100).toFixed(0)}%`);
    if (!result.hasSpeech) {
      console.log(`     Issues: ${result.issues.join('; ')}`);
      allValid = false;
    }
  }

  // Step 4: Combine segments and validate combined output
  console.log('');
  console.log('📢 Step 4: Combining and validating full podcast...');

  try {
    // Read all wav buffers
    const buffers = [];
    for (const seg of segments) {
      buffers.push(await seg.blob.arrayBuffer());
    }

    // Extract PCM data from each, combine into single WAV
    let totalPcmLen = 0;
    let sampleRate = 24000;
    let channels = 1;
    let bitsPerSample = 16;
    const pcmChunks = [];

    for (const buf of buffers) {
      const view = new DataView(buf);
      let offset = 12;
      let localSampleRate = 24000;
      let localChannels = 1;
      let localBits = 16;

      while (offset < buf.byteLength - 8) {
        const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === 'fmt ') {
          localChannels = view.getUint16(offset + 10, true);
          localSampleRate = view.getUint32(offset + 12, true);
          localBits = view.getUint16(offset + 22, true);
          sampleRate = localSampleRate;
          channels = localChannels;
          bitsPerSample = localBits;
        }

        if (chunkId === 'data') {
          const pcmData = buf.slice(offset + 8, offset + 8 + chunkSize);
          pcmChunks.push(pcmData);
          totalPcmLen += pcmData.byteLength;
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
      }
    }

    // Write combined WAV
    const blockAlign = channels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const headerSize = 44;
    const combinedBuf = new ArrayBuffer(headerSize + totalPcmLen);
    const wavView = new DataView(combinedBuf);

    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) wavView.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    wavView.setUint32(4, combinedBuf.byteLength - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    wavView.setUint32(16, 16, true);
    wavView.setUint16(20, 1, true);
    wavView.setUint16(22, channels, true);
    wavView.setUint32(24, sampleRate, true);
    wavView.setUint32(28, byteRate, true);
    wavView.setUint16(32, blockAlign, true);
    wavView.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    wavView.setUint32(40, totalPcmLen, true);

    let writeOffset = 44;
    for (const chunk of pcmChunks) {
      const src = new Uint8Array(chunk);
      const dst = new Uint8Array(combinedBuf);
      dst.set(src, writeOffset);
      writeOffset += src.length;
    }

    writeFileSync(join(OUTPUT_DIR, 'combined_podcast.wav'), Buffer.from(combinedBuf));
    console.log(`  📁 Wrote combined_podcast.wav (${combinedBuf.byteLength} bytes)`);

    // Validate combined
    const combinedResult = validateWavHeader(combinedBuf);
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  VALIDATION RESULTS');
    console.log('═══════════════════════════════════════════');
    console.log(`  Segments generated:  ${segments.length}/${testPhrases.length}`);
    console.log(`  Combined duration:   ${combinedResult.duration.toFixed(1)}s`);
    console.log(`  Sample rate:         ${combinedResult.sampleRate}Hz`);
    console.log(`  Channels:            ${combinedResult.channels}`);
    console.log(`  RMS energy:          ${combinedResult.rms.toFixed(4)}`);
    console.log(`  Silence ratio:       ${(combinedResult.silenceRatio * 100).toFixed(0)}%`);
    console.log(`  Has speech content:  ${combinedResult.hasSpeech ? '✅ YES' : '❌ NO'}`);

    if (combinedResult.issues.length > 0) {
      console.log(`  Issues:              ${combinedResult.issues.join(', ')}`);
    }

    const passed = allValid && combinedResult.hasSpeech;
    console.log('');
    console.log(passed ? '  ✅ PIPELINE VALIDATION PASSED' : '  ❌ PIPELINE VALIDATION FAILED');
    console.log('');

    if (!passed) {
      process.exit(1);
    }

  } catch (e) {
    console.error('  ❌ Combine/validate failed:', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
