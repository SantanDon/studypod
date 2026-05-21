import { KokoroTTS } from 'kokoro-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../../uploads/test_output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const text = "Welcome to StudyPod LM. This is a test of voice differentiation.";
const voices = ['af_bella', 'am_michael'];
const files = [];

for (const voice of voices) {
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", { dtype: "q8", device: "cpu" });
    const audio = await tts.generate(text, { voice });
    const outPath = path.join(outDir, `voice_${voice}.wav`);
    await audio.save(outPath);
    files.push(outPath);
    console.log('Generated:', outPath);
}

console.log('\nFiles ready for comparison:');
for (const f of files) console.log(' ', f);
