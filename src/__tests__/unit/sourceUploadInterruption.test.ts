import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSourceUpload, clearUploadInterruption, readRecoverableUploadInterruptions, readUploadInterruptions, recordUploadInterruption, reconcileUploadInterruptions, ownsUploadInterruptionSource, SourceSaveError, subscribeUploadInterruptions, UPLOAD_INTERRUPTION_REASON, GUEST_UPLOAD_INTERRUPTION_REASON } from '@/lib/sources/sourceUploadInterruption';

const scope = { ownerId: 'owner-a', notebookId: 'notebook-a' };
const input = { sourceId: 'source-a', fileName: 'synthetic.txt', stage: 'saving' as const };
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('upload interruption recovery receipts', () => {
  it('isolates the guest namespace, suppresses healthy work and exposes filename-specific recovery after reload', async () => {
    const guestScope = { ...scope, kind: 'guest' as const };
    beginSourceUpload(guestScope, input);
    expect(readRecoverableUploadInterruptions(guestScope)).toEqual([]);
    expect(readUploadInterruptions(scope)).toEqual([]);
    expect(readUploadInterruptions({ ...guestScope, ownerId: 'other-guest' })).toEqual([]);
    expect(readUploadInterruptions({ ...guestScope, notebookId: 'other-notebook' })).toEqual([]);
    vi.resetModules();
    const freshDocument = await import('@/lib/sources/sourceUploadInterruption');
    expect(freshDocument.readRecoverableUploadInterruptions(guestScope)).toEqual([
      { ...input, occurredAt: expect.any(String), reason: GUEST_UPLOAD_INTERRUPTION_REASON },
    ]);
    freshDocument.clearUploadInterruption(guestScope, input.sourceId);
    expect(freshDocument.readUploadInterruptions(guestScope)).toEqual([]);
  });
  it('requires verified guest notebook ownership while keeping cloud source ownership strict', () => {
    const guestScope = { ...scope, kind: 'guest' as const };
    const source = { id: input.sourceId, notebook_id: scope.notebookId, processing_status: 'failed' };
    const notebook = { id: scope.notebookId, user_id: scope.ownerId };
    recordUploadInterruption(guestScope, input);
    expect(ownsUploadInterruptionSource(scope, source, notebook)).toBe(false);
    reconcileUploadInterruptions(guestScope, [source]);
    reconcileUploadInterruptions(guestScope, [source], { ...notebook, user_id: 'other-guest' });
    reconcileUploadInterruptions(guestScope, [source], { ...notebook, id: 'other-notebook' });
    reconcileUploadInterruptions(guestScope, [], notebook);
    reconcileUploadInterruptions(guestScope, [{ ...source, processing_status: 'processing' }], notebook);
    expect(readUploadInterruptions(guestScope)).toHaveLength(1);
    reconcileUploadInterruptions(guestScope, [source], notebook);
    expect(readUploadInterruptions(guestScope)).toEqual([]);
  });
  it('persists queued uploads immediately, hides healthy live work and exposes it in a fresh document', async () => {
    beginSourceUpload(scope, input);
    expect(readUploadInterruptions(scope)).toHaveLength(1);
    expect(readRecoverableUploadInterruptions(scope)).toEqual([]);
    vi.resetModules();
    const freshDocument = await import('@/lib/sources/sourceUploadInterruption');
    expect(freshDocument.readRecoverableUploadInterruptions(scope)).toEqual([{ ...input, occurredAt: expect.any(String), reason: UPLOAD_INTERRUPTION_REASON }]);
    clearUploadInterruption(scope, input.sourceId);
  });
  it('exposes a caught persistence outage immediately and hides no other account receipt', () => {
    beginSourceUpload(scope, input);
    recordUploadInterruption({ ...scope, ownerId: 'owner-b' }, input);
    expect(readRecoverableUploadInterruptions({ ...scope, ownerId: 'owner-b' })).toHaveLength(1);
    recordUploadInterruption(scope, input);
    expect(readRecoverableUploadInterruptions(scope)).toHaveLength(1);
    clearUploadInterruption(scope, input.sourceId);
  });
  it('survives a fresh read, isolates accounts and notebooks, and stores only whitelisted recovery fields', () => {
    recordUploadInterruption(scope, { ...input, content: 'DO NOT RETAIN', token: 'DO NOT RETAIN' } as typeof input);
    expect(readUploadInterruptions(scope)).toEqual([{ ...input, occurredAt: expect.any(String), reason: UPLOAD_INTERRUPTION_REASON }]);
    expect(readUploadInterruptions({ ...scope, ownerId: 'owner-b' })).toEqual([]);
    expect(readUploadInterruptions({ ...scope, notebookId: 'notebook-b' })).toEqual([]);
    expect(localStorage.getItem(localStorage.key(0)!)).not.toContain('DO NOT RETAIN');
  });
  it('notifies this tab on record and confirmed deletion, and unsubscribes cleanly', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeUploadInterruptions(callback);
    recordUploadInterruption(scope, input);
    expect(callback).toHaveBeenCalledTimes(1);
    clearUploadInterruption(scope, input.sourceId);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(readUploadInterruptions(scope)).toEqual([]);
    unsubscribe();
    recordUploadInterruption(scope, input);
    expect(callback).toHaveBeenCalledTimes(2);
  });
  it('retains absent, pending and other-owner records; clears only acknowledged owned terminal data', () => {
    recordUploadInterruption(scope, input);
    reconcileUploadInterruptions(scope, []);
    reconcileUploadInterruptions(scope, [{ id: input.sourceId, user_id: scope.ownerId, notebook_id: scope.notebookId, processing_status: 'pending' }]);
    reconcileUploadInterruptions(scope, [{ id: input.sourceId, user_id: 'owner-b', notebook_id: scope.notebookId, processing_status: 'completed' }]);
    reconcileUploadInterruptions(scope, [{ id: input.sourceId, user_id: scope.ownerId, notebook_id: 'notebook-b', processing_status: 'failed' }]);
    expect(readUploadInterruptions(scope)).toHaveLength(1);
    reconcileUploadInterruptions(scope, [{ id: input.sourceId, user_id: scope.ownerId, notebook_id: scope.notebookId, processing_status: 'failed' }]);
    expect(readUploadInterruptions(scope)).toEqual([]);
  });
  it('guards unavailable storage without masking the upload error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => recordUploadInterruption(scope, input)).not.toThrow();
    expect(() => clearUploadInterruption(scope, input.sourceId)).not.toThrow();
    expect(readUploadInterruptions(scope)).toEqual([]);
    expect(new SourceSaveError()).toMatchObject({ code: 'SOURCE_SAVE_FAILED', stage: 'saving' });
  });
});
