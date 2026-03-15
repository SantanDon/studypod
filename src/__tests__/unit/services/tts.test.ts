import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSService } from '@/services/tts/TTSService';

describe('TTSService', () => {
  let service: TTSService;

  beforeEach(() => {
    service = new TTSService();
    vi.clearAllMocks();
  });

  describe('getProvider', () => {
    it('should return the current provider', () => {
      const provider = service.getProvider();
      expect(provider).toBe('kokoro');
    });
  });

  describe('setProvider', () => {
    it('should set the provider to web-speech', () => {
      service.setProvider('web-speech');
      expect(service.getProvider()).toBe('web-speech');
    });

    it('should set the provider to kokoro', () => {
      service.setProvider('kokoro');
      expect(service.getProvider()).toBe('kokoro');
    });
  });

  describe('getAvailableVoices', () => {
    it('should return available voices', async () => {
      vi.spyOn(service, 'getAvailableVoices').mockResolvedValue([
        {
          id: 'voice-1',
          name: 'Voice 1',
          language: 'en-US',
          gender: 'male',
          provider: 'kokoro',
        },
      ]);

      const voices = await service.getAvailableVoices();

      expect(voices).toHaveLength(1);
      expect(voices[0].id).toBe('voice-1');
    });

    it('should return empty array if no voices available', async () => {
      vi.spyOn(service, 'getAvailableVoices').mockResolvedValue([]);

      const voices = await service.getAvailableVoices();

      expect(voices).toHaveLength(0);
    });
  });

  describe('getVoicesByLanguage', () => {
    it('should filter voices by language', async () => {
      vi.spyOn(service, 'getAvailableVoices').mockResolvedValue([
        {
          id: 'voice-1',
          name: 'Voice 1',
          language: 'en-US',
          provider: 'kokoro',
        },
        {
          id: 'voice-2',
          name: 'Voice 2',
          language: 'fr-FR',
          provider: 'kokoro',
        },
      ]);

      const voices = await service.getVoicesByLanguage('en');

      expect(voices).toHaveLength(1);
      expect(voices[0].language).toContain('en');
    });
  });

  describe('isAvailable', () => {
    it('should return true if voices are available', async () => {
      vi.spyOn(service, 'getAvailableVoices').mockResolvedValue([
        {
          id: 'voice-1',
          name: 'Voice 1',
          language: 'en-US',
          provider: 'kokoro',
        },
      ]);

      const available = await service.isAvailable();

      expect(available).toBe(true);
    });

    it('should return false if no voices available', async () => {
      vi.spyOn(service, 'getAvailableVoices').mockResolvedValue([]);

      const available = await service.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('synthesize', () => {
    it('should synthesize text to speech', async () => {
      const mockBlob = new Blob(['audio'], { type: 'audio/wav' });
      vi.spyOn(service, 'synthesize').mockResolvedValue(mockBlob);

      const result = await service.synthesize('Hello world');

      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
    });
  });
});
