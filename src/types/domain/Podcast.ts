import { z } from 'zod';

/**
 * Podcast domain model
 * Represents a generated podcast episode
 */
export const PodcastSchema = z.object({
  id: z.string().describe('Unique identifier'),
  notebook_id: z.string().describe('Parent notebook ID'),
  title: z.string().min(1).describe('Podcast title'),
  created_at: z.string().datetime().describe('Creation timestamp'),
  duration: z.number().optional().describe('Duration in seconds'),
  audio_blob_id: z.string().describe('IndexedDB key for audio blob'),
  script: z.string().optional().describe('Podcast script'),
  speakers: z.array(z.string()).optional().describe('Speaker names'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

export type Podcast = z.infer<typeof PodcastSchema>;

/**
 * Input type for creating a new podcast
 */
export const CreatePodcastInputSchema = PodcastSchema.omit({
  id: true,
  created_at: true,
});

export type CreatePodcastInput = z.infer<typeof CreatePodcastInputSchema>;

/**
 * Input type for updating a podcast
 */
export const UpdatePodcastInputSchema = PodcastSchema.partial().omit({
  id: true,
  notebook_id: true,
  created_at: true,
});

export type UpdatePodcastInput = z.infer<typeof UpdatePodcastInputSchema>;
