/**
 * TTS Service
 * Orchestrates text-to-speech operations
 */

export { ITTSService, Voice, TTSOptions } from './ITTSService';
export { TTSService } from './TTSService';

// Create singleton instance
import { TTSService } from './TTSService';

export const ttsService = new TTSService();
