import { Podcast, CreatePodcastInput } from '@/types/domain';

/**
 * Factory for creating Podcast domain objects
 */
export class PodcastFactory {
  /**
   * Create a new podcast instance
   */
  static create(input: CreatePodcastInput): Podcast {
    return {
      id: this.generateId(),
      ...input,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Create a podcast from existing data
   */
  static fromData(data: Partial<Podcast>): Podcast {
    return {
      id: data.id || this.generateId(),
      notebook_id: data.notebook_id || '',
      title: data.title || 'Untitled Podcast',
      created_at: data.created_at || new Date().toISOString(),
      duration: data.duration,
      audio_blob_id: data.audio_blob_id || '',
      script: data.script,
      speakers: data.speakers,
      metadata: data.metadata,
    };
  }

  /**
   * Create a test podcast
   */
  static createTest(overrides?: Partial<Podcast>): Podcast {
    return {
      id: 'test-podcast-' + Math.random().toString(36).substr(2, 9),
      notebook_id: 'test-notebook',
      title: 'Test Podcast',
      created_at: new Date().toISOString(),
      duration: 300,
      audio_blob_id: 'test-blob-id',
      script: 'This is a test podcast script',
      speakers: ['Host 1', 'Host 2'],
      ...overrides,
    };
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
