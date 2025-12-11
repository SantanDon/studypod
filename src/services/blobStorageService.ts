import { get, set, del } from 'idb-keyval';

/**
 * Service to handle large binary data (Blobs) using IndexedDB
 * This avoids the 5MB limit of localStorage and issues with string serialization
 */

const AUDIO_STORE_PREFIX = 'podcast_audio_';

export const blobStorageService = {
  /**
   * Save a podcast audio blob
   * @param notebookId The notebook ID associated with this audio
   * @param blob The audio Blob
   */
  async savePodcastAudio(notebookId: string, blob: Blob): Promise<void> {
    try {
      await set(`${AUDIO_STORE_PREFIX}${notebookId}`, blob);
      console.log(`✅ Saved audio blob for notebook ${notebookId} to IndexedDB`);
    } catch (error) {
      console.error('Failed to save audio blob to IndexedDB:', error);
      throw error;
    }
  },

  /**
   * Retrieve a podcast audio blob
   * @param notebookId The notebook ID
   * @returns The Blob or undefined if not found
   */
  async getPodcastAudio(notebookId: string): Promise<Blob | undefined> {
    try {
      const blob = await get<Blob>(`${AUDIO_STORE_PREFIX}${notebookId}`);
      return blob;
    } catch (error) {
      console.error('Failed to get audio blob from IndexedDB:', error);
      return undefined;
    }
  },

  /**
   * Delete a podcast audio blob
   * @param notebookId The notebook ID
   */
  async deletePodcastAudio(notebookId: string): Promise<void> {
    try {
      await del(`${AUDIO_STORE_PREFIX}${notebookId}`);
      console.log(`🗑️ Deleted audio blob for notebook ${notebookId} from IndexedDB`);
    } catch (error) {
      console.error('Failed to delete audio blob from IndexedDB:', error);
      throw error;
    }
  }
};
