import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageService } from '@/services/localStorageService';

const storage = vi.hoisted(() => ({ data: new Map<string, string>(), fail: false, queueSync: vi.fn() }));
vi.mock('@/lib/storage/storageManager', () => ({
  storageManager: {
    safeGetItem: (key: string) => storage.data.get(key) ?? null,
    safeSetItem: (key: string, value: string) => {
      if (storage.fail) return { success: false, error: 'Storage quota exceeded' };
      storage.data.set(key, value);
      return { success: true };
    },
  },
  getStorageStats: vi.fn(), formatBytes: vi.fn(),
}));
vi.mock('@/services/encryptionService', () => ({ encryptionService: {} }));
vi.mock('@/lib/sync/syncManager', () => ({ getSyncManager: () => ({ queueSync: storage.queueSync }) }));

describe('local source mutations require a durable storage acknowledgment', () => {
  beforeEach(() => {
    storage.data.clear();
    storage.fail = false;
    storage.queueSync.mockReset().mockResolvedValue(undefined);
    storage.data.set('sources', JSON.stringify([{ id: 'source', notebook_id: 'notebook', title: 'Queued.txt', processing_status: 'pending' }]));
    storage.data.set('notebooks', JSON.stringify([{ id: 'notebook', user_id: 'guest_test', title: 'My notebook' }]));
  });

  it('rejects a failed update and retains the persisted pending source', () => {
    storage.fail = true;
    expect(() => localStorageService.updateSource('source', { processing_status: 'completed' })).toThrow('Failed to update source: Storage quota exceeded');
    expect(localStorageService.getSourceById('source')?.processing_status).toBe('pending');
    expect(storage.queueSync).not.toHaveBeenCalled();
  });

  it('rejects a failed delete and retains the source without syncing a false deletion', () => {
    storage.fail = true;
    expect(() => localStorageService.deleteSource('source')).toThrow('Failed to delete source: Storage quota exceeded');
    expect(localStorageService.getSourceById('source')?.title).toBe('Queued.txt');
    expect(storage.queueSync).not.toHaveBeenCalled();
  });

  it('acknowledges updates and deletes only after the persisted records change', () => {
    expect(localStorageService.updateSource('source', { processing_status: 'completed' })?.processing_status).toBe('completed');
    expect(localStorageService.getSourceById('source')?.processing_status).toBe('completed');
    expect(localStorageService.deleteSource('source')).toBe(true);
    expect(localStorageService.getSourceById('source')).toBeNull();
    expect(storage.queueSync).toHaveBeenCalledTimes(1);
    expect(localStorageService.deleteSource('source')).toBe(false);
    expect(storage.queueSync).toHaveBeenCalledTimes(1);
  });
});
