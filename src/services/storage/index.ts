/**
 * Storage Service
 * Abstracts storage operations for all domain models
 */

export { IStorageService } from './IStorageService';
export { LocalStorageServiceImpl } from './LocalStorageServiceImpl';

// Create singleton instance
import { LocalStorageServiceImpl } from './LocalStorageServiceImpl';

export const storageService = new LocalStorageServiceImpl();
