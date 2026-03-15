import { ITTSService, Voice, TTSOptions } from './ITTSService';
import { getKokoroTTSProvider } from '@/lib/tts/kokoroTTSProvider';
import { WebSpeechProvider } from '@/lib/tts/webSpeechProvider';

/**
 * TTS Service
 * Orchestrates text-to-speech operations
 */
export class TTSService implements ITTSService {
  private provider: 'kokoro' | 'web-speech' = 'kokoro';
  private kokoroProvider = getKokoroTTSProvider();
  private webSpeechProvider = new WebSpeechProvider();

  constructor() {
    // Initialize with default provider
    this.provider = 'kokoro';
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options?: TTSOptions): Promise<Blob> {
    try {
      if (this.provider === 'kokoro') {
        const response = await this.kokoroProvider.synthesize({
          text,
          voice: typeof options?.voiceId === 'string' ? options.voiceId : undefined,
          speed: typeof options?.speed === 'number' ? options.speed : 1.0,
        });
        return response.audioBlob;
      } else {
        const response = await this.webSpeechProvider.synthesize({
          text,
          voice: typeof options?.voiceId === 'string' ? options.voiceId : undefined,
          speed: typeof options?.speed === 'number' ? options.speed : 1.0,
        });
        return response.audioBlob;
      }
    } catch (error) {
      console.error('Failed to synthesize speech:', error);
      throw new Error('Failed to synthesize speech');
    }
  }

  /**
   * Get available voices
   */
  async getAvailableVoices(): Promise<Voice[]> {
    try {
      if (this.provider === 'kokoro') {
        const voices = await this.kokoroProvider.getVoices();
        return voices.map(v => ({
          id: v.id,
          name: v.name,
          language: v.language,
          provider: 'kokoro',
        }));
      } else {
        const voices = await this.webSpeechProvider.getVoices();
        return voices.map(v => ({
          id: v.id,
          name: v.name,
          language: v.language,
          provider: 'web-speech',
        }));
      }
    } catch (error) {
      console.error('Failed to get voices:', error);
      return [];
    }
  }

  /**
   * Get voices for a specific language
   */
  async getVoicesByLanguage(language: string): Promise<Voice[]> {
    const voices = await this.getAvailableVoices();
    return voices.filter((v) => v.language.startsWith(language));
  }

  /**
   * Check if the service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (this.provider === 'kokoro') {
        return await this.kokoroProvider.isAvailable();
      } else {
        return await this.webSpeechProvider.isAvailable();
      }
    } catch {
      return false;
    }
  }

  /**
   * Get the current provider name
   */
  getProvider(): string {
    return this.provider;
  }

  /**
   * Set the current provider
   */
  setProvider(provider: 'kokoro' | 'web-speech'): void {
    this.provider = provider;
  }
}
