/**
 * TTS Service Interface
 * Abstracts text-to-speech operations
 */

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  provider: string;
}

export interface TTSOptions {
  voiceId?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface ITTSService {
  /**
   * Synthesize text to speech
   */
  synthesize(text: string, options?: TTSOptions): Promise<Blob>;

  /**
   * Get available voices
   */
  getAvailableVoices(): Promise<Voice[]>;

  /**
   * Get voices for a specific language
   */
  getVoicesByLanguage(language: string): Promise<Voice[]>;

  /**
   * Check if the service is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the current provider name
   */
  getProvider(): string;

  /**
   * Set the current provider
   */
  setProvider(provider: 'kokoro' | 'web-speech'): void;
}
