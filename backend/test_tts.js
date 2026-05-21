import { KokoroTTS } from 'kokoro-js';
import fs from 'fs';
import path from 'path';

async function test() {
  console.log('Testing Kokoro-JS...');
  try {
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", {
      dtype: "q8",
      device: "cpu"
    });
    
    console.log('Generating sample audio...');
    const audio = await tts.generate("Hello, LO. This is a test of the audiobook engine.", { 
      voice: "af_bella" 
    });
    
    const outputPath = './test_audio.wav';
    await audio.save(outputPath);
    
    if (fs.existsSync(outputPath)) {
      console.log('✅ Success: Audio generated and saved to', outputPath);
      const stats = fs.statSync(outputPath);
      console.log('File size:', stats.size, 'bytes');
    } else {
      console.log('❌ Failure: File was not saved.');
    }
  } catch (err) {
    console.error('❌ Error during generation:', err);
  }
}

test();
