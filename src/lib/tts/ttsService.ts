/**
 * TTS Service - Abstract interface for Text-to-Speech providers
 * Supports Ultimate TTS Studio, Coqui TTS, and other local TTS servers
 */

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  provider: 'ultimate-tts' | 'coqui' | 'openai-tts' | 'web-speech' | 'kokoro' | 'kokoro-premium';
  gender?: 'male' | 'female' | 'neutral';
}

export interface TTSConfig {
  provider: 'kokoro' | 'ultimate-tts' | 'coqui' | 'openai-tts' | 'web-speech';
  endpoint: string;
  apiKey?: string;
  defaultVoice?: string;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
}

export interface TTSResponse {
  audioBlob: Blob;
  audioUrl: string;
  duration?: number;
}

export interface TTSProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  getVoices(): Promise<TTSVoice[]>;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
}

// Default TTS settings stored in localStorage
const TTS_CONFIG_KEY = 'tts_provider_config';

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  provider: 'kokoro', // Default to Kokoro TTS (high quality, runs in browser)
  endpoint: 'http://localhost:7860', // Only used if provider is 'ultimate-tts'
};

export function getTTSConfig(): TTSConfig {
  try {
    const stored = localStorage.getItem(TTS_CONFIG_KEY);
    if (stored) {
      return { ...DEFAULT_TTS_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('Failed to load TTS config:', e);
  }
  return DEFAULT_TTS_CONFIG;
}

export function saveTTSConfig(config: Partial<TTSConfig>): void {
  const current = getTTSConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(TTS_CONFIG_KEY, JSON.stringify(updated));
}
