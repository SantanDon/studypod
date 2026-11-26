/**
 * TTS Worker Script
 * Runs Kokoro TTS inference off the main thread
 * 
 * This worker handles heavy ONNX inference without blocking the UI
 */

import { generateCompleteKokoroAudio } from './kokoroTokenGeneration';

// Worker message types
interface TTSWorkerRequest {
  type: 'init' | 'synthesize' | 'cancel' | 'checkWebGPU';
  id?: string;
  text?: string;
  voice?: string;
  speed?: number;
}

interface TTSWorkerResponse {
  type: 'ready' | 'progress' | 'audio' | 'error' | 'webgpu-status';
  id?: string;
  audioData?: ArrayBuffer;
  duration?: number;
  message?: string;
  percentage?: number;
  webgpuAvailable?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoroInstance: any = null; // Keeping as any for now due to complex internal type from kokoro-js
let isInitializing = false;
let currentRequestId: string | null = null;

// Post message helper
function postResponse(response: TTSWorkerResponse) {
  self.postMessage(response);
}

// Check WebGPU availability
async function checkWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
      return adapter !== null;
    }
    return false;
  } catch {
    return false;
  }
}

// Initialize Kokoro TTS
async function initializeKokoro(): Promise<void> {
  if (kokoroInstance || isInitializing) return;
  
  isInitializing = true;
  
  try {
    postResponse({
      type: 'progress',
      message: 'Preparing the reading voice on this device…',
      percentage: 10,
    });

    // Dynamic import of Kokoro
    const { KokoroTTS } = await import('kokoro-js');
    
    postResponse({
      type: 'progress',
      message: 'Checking for saved voice files…',
      percentage: 30,
    });

    // For stability and to prevent silent/garbled audio issues in WebGPU workers, we use WASM fp32 by default.
    const device = 'wasm';
    const dtype = 'fp32';

    postResponse({
      type: 'progress',
      message: 'Opening the voice model. On first use, keep this tab open while its files download.',
      percentage: 40,
    });

    const transfers = new Map<string, { started: number; initial: number; loaded: number }>();
    let lastReport = -Infinity;
    kokoroInstance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype,
      device,
      progress_callback: (event) => {
        if (event.status !== 'progress' || !Number.isFinite(event.loaded) || event.loaded < 0) return;
        const now = performance.now();
        let transfer = transfers.get(event.file);
        if (transfer && event.loaded <= transfer.loaded) return;
        if (!transfer) {
          transfer = { started: now, initial: event.loaded, loaded: event.loaded };
          transfers.set(event.file, transfer);
        }
        transfer.loaded = event.loaded;
        if (now - lastReport < 1000) return;
        lastReport = now;
        const received = (event.loaded / 1_000_000).toFixed(1);
        let detail = event.loaded < 1000 ? `${event.loaded} bytes received` :
          event.loaded < 100_000 ? `${Math.round(event.loaded / 1000)} kB received` : `${received} MB received`;
        if (Number.isFinite(event.total) && event.total > 0 && event.loaded <= event.total) {
          const percent = Math.floor(100 * event.loaded / event.total);
          detail = `${percent}% · ${received} of ${(event.total / 1_000_000).toFixed(1)} MB`;
          const elapsed = (now - transfer.started) / 1000;
          const gained = event.loaded - transfer.initial;
          if (elapsed >= 2 && gained > 0 && event.loaded < event.total) {
            const seconds = Math.ceil(elapsed * (event.total - event.loaded) / gained);
            const estimate = seconds < 60 ? `${seconds} sec` : `${Math.ceil(seconds / 60)} min`;
            detail += ` · about ${estimate} left for this file`;
          }
        }
        postResponse({
          type: 'progress',
          message: `Downloading voice file ${event.file.split('/').pop()} · ${detail}`,
          percentage: 40,
        });
      },
    });

    // List available voices for debugging
    try {
      const voices = kokoroInstance.list_voices?.() || [];
      console.log('Available Kokoro voices:', voices);
    } catch (e) {
      console.log('Could not list voices:', e);
    }
    
    postResponse({
      type: 'ready',
      message: 'Kokoro TTS ready!',
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    postResponse({
      type: 'error',
      message: `Failed to initialize Kokoro TTS: ${errorMessage}`,
    });
  } finally {
    isInitializing = false;
  }
}


// Synthesize text to audio
async function synthesize(id: string, text: string, voice: string, speed: number): Promise<void> {
  if (!kokoroInstance) {
    postResponse({
      type: 'error',
      id,
      message: 'Kokoro TTS not initialized',
    });
    return;
  }

  currentRequestId = id;

  try {
    // Log the parameters for debugging
    console.log(`Kokoro TTS: Generating with voice="${voice}", speed=${speed}, text="${text.substring(0, 50)}..."`);
    
    postResponse({
      type: 'progress',
      id,
      message: `Generating audio with voice: ${voice}...`,
      percentage: 0,
    });

    // Generate audio with explicit voice parameter
    // The voice should be one of: af_heart, af_bella, am_michael, etc.
    const audio = await generateCompleteKokoroAudio(kokoroInstance, text, {
      voice: voice, // e.g., "am_michael" or "af_bella"
      speed: speed,
    }, () => currentRequestId !== id);

    console.log(`Kokoro TTS: Generated audio, duration=${audio.duration}s`);

    // Check if cancelled
    if (currentRequestId !== id) {
      return;
    }

    // Sanity check - if duration is too short for the text, something went wrong
    const expectedMinDuration = text.split(/\s+/).length / 200; // ~200 words per minute max
    if (audio.duration < expectedMinDuration * 0.5) {
      console.warn(`Kokoro TTS: Audio duration (${audio.duration}s) seems too short for text length. May be gibberish.`);
    }

    // Convert to ArrayBuffer for transfer
    const audioBlob = await audio.toBlob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    if (currentRequestId !== id) return;

    postResponse({
      type: 'audio',
      id,
      audioData: arrayBuffer,
      duration: audio.duration,
    });

  } catch (error) {
    console.error('Kokoro TTS synthesis error:', error);
    if (currentRequestId === id) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      postResponse({
        type: 'error',
        id,
        message: `Synthesis failed: ${errorMessage}`,
      });
    }
  }
}

// Handle incoming messages
self.onmessage = async (event: MessageEvent<TTSWorkerRequest>) => {
  const { type, id, text, voice, speed } = event.data;

  switch (type) {
    case 'init':
      await initializeKokoro();
      break;
    case 'checkWebGPU': {
      const available = await checkWebGPU();
      postResponse({
        type: 'webgpu-status',
        webgpuAvailable: available,
      });
      break;
    }
    case 'synthesize':
      if (!id || !text || !voice) {
        postResponse({
          type: 'error',
          id,
          message: 'Missing required parameters for synthesis',
        });
        return;
      }
      await synthesize(id, text, voice, speed || 1.0);
      break;
    case 'cancel':
      currentRequestId = null;
      break;
    default:
      postResponse({
        type: 'error',
        message: `Unknown message type: ${type}`,
      });
  }
};

// Signal that worker is loaded
postResponse({
  type: 'progress',
  message: 'TTS Worker loaded',
  percentage: 0,
});
