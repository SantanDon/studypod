/**
 * Memory Service
 * 
 * Bridge between StudyPod LM and EverMemOS.
 * Provides long-term persistent memory storage and retrieval for AI Agents.
 */

import fetch from 'node-fetch';

const EVERMEMOS_URL = process.env.EVERMEMOS_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVERMEMOS_API_KEY;

export const MemoryService = {
  /**
   * storeMemory
   * Persists a piece of content to EverMemOS long-term memory.
   * 
   * @param {string} userId - The unique identifier for the user/agent
   * @param {string} content - The text to remember
   * @param {Object} metadata - Optional context components (e.g., notebook_id, source)
   */
  async storeMemory(userId, content, metadata = {}) {
    console.log(`[MemoryService] Storing memory for user ${userId}...`);
    
    if (!API_KEY) {
      console.warn('[MemoryService] EVERMEMOS_API_KEY not configured. Skipping persistence.');
      return null;
    }

    try {
      const response = await fetch(`${EVERMEMOS_URL}/api/v1/memories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          userId,
          content,
          metadata: {
            ...metadata,
            source: 'studypod_lm',
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to store memory in EverMemOS');
      }

      const data = await response.json();
      console.log('[MemoryService] Memory stored successfully:', data.id);
      return data;
    } catch (error) {
      console.error('[MemoryService] Error storing memory:', error.message);
      return null;
    }
  },

  /**
   * searchMemories
   * Retrieves relevant context from EverMemOS using semantic search.
   * 
   * @param {string} userId - The user/agent context
   * @param {string} query - The search query
   * @param {Object} filters - Optional filters (e.g., notebook_id)
   */
  async searchMemories(userId, query, filters = {}) {
    console.log(`[MemoryService] Searching memories for user ${userId}: "${query}"`);

    if (!API_KEY) {
      console.warn('[MemoryService] EVERMEMOS_API_KEY not configured. Returning empty results.');
      return [];
    }

    try {
      const response = await fetch(`${EVERMEMOS_URL}/api/v1/memories/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          userId,
          query,
          method: 'hybrid', // Default to hybrid for best accuracy
          limit: 5,
          filters
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to search memories in EverMemOS');
      }

      const data = await response.json();
      console.log(`[MemoryService] Found ${data.results?.length || 0} relevant memories.`);
      return data.results || [];
    } catch (error) {
      console.error('[MemoryService] Error searching memories:', error.message);
      return [];
    }
  }
};

export default MemoryService;
