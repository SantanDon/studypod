import { generatePodcastScript } from '@/lib/podcastGenerator';
import { PodcastAudioGenerator, getPodcastAudioGenerator } from '@/lib/tts/podcastAudioGenerator';
import { aiService } from '@/services/ai';
import { getKokoroPremiumProvider } from '@/lib/tts/kokoroPremiumTTSProvider';

// Mock AI summary generation
jest.mock('@/services/ai', () => ({
  aiService: {
    generateSummary: jest.fn().mockResolvedValue('Summary of section'),
    generateResponse: jest.fn().mockResolvedValue('{"title":"Test Podcast","segments":[{"speaker":"Alex","text":"Hello world."}]}'),
  },
}));

// Mock TTS providers
jest.mock('@/lib/tts/kokoroPremiumTTSProvider', () => ({
  getKokoroPremiumProvider: () => ({
    isAvailable: jest.fn().mockResolvedValue(true),
    synthesize: jest.fn().mockResolvedValue({ audioUrl: 'blob://test', duration: 100 }),
    getVoices: jest.fn().mockResolvedValue([]),
  })
}));

// Mock worker manager to avoid real synthesis
jest.mock('@/lib/tts/ttsWorker', () => ({
  getTTSWorkerManager: () => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    synthesize: jest.fn().mockResolvedValue({ audioUrl: 'blob://test', duration: 100 }),
    isWorkerReady: jest.fn().mockReturnValue(true),
  })
}));

test('full podcast generation produces script with >= 40 segments and audio', async () => {
  const content = 'Full content with multiple sections...';
  const script = await generatePodcastScript(content, undefined, undefined, 'standard');
  expect(script.segments.length).toBeGreaterThanOrEqual(40);

  const generator = getPodcastAudioGenerator();
  const result = await generator.generatePodcastAudio(script, {}, undefined, 'standard');
  expect(result.segments.length).toBeGreaterThanOrEqual(40);
  expect(result.duration).toBeGreaterThan(60);
});
