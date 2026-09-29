import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createAudiobookAdmissionGuard, isOwnedAudiobookManifest } from '../services/audiobookRequestGuard.js';
function response() {
    const res = new EventEmitter();
    res.locals = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}
const request = (owner = 'owner-a', fileName = 'book.pdf') => ({ user: { id: owner }, body: { fileName } });
const guard = () => createAudiobookAdmissionGuard({ ownerFor: (req) => req.user?.id, fileFor: (file) => file.trim().toLowerCase() });
describe('explicit audiobook manifest ownership', () => {
    it('accepts only the authenticated owner', () => expect(isOwnedAudiobookManifest({ ownerId: 'owner-a' }, 'owner-a')).toBe(true));
    it.each([undefined, null, {}, { ownerId: '' }, { ownerId: 'owner-b' }])('does not grant access to foreign or ownerless state: %j', (manifest) => expect(isOwnedAudiobookManifest(manifest, 'owner-a')).toBe(false));
    it('does not equate two absent owners with authorization', () => expect(isOwnedAudiobookManifest({}, '')).toBe(false));
});
describe('full audiobook admission serialization', () => {
    it('rejects a concurrent duplicate until asynchronous setup has finished', () => {
        const middleware = guard();
        const first = response();
        const next = vi.fn();
        middleware(request(), first, next);
        const second = response();
        middleware(request(), second, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(second.status).toHaveBeenCalledWith(409);
        first.locals.releaseAudiobookAdmission();
        middleware(request(), response(), next);
        expect(next).toHaveBeenCalledTimes(2);
    });
    it('does not unlock prematurely when a client disconnects during setup', () => {
        const middleware = guard();
        const first = response();
        middleware(request(), first, vi.fn());
        first.emit('close');
        const second = response();
        middleware(request(), second, vi.fn());
        expect(second.status).toHaveBeenCalledWith(409);
        first.locals.releaseAudiobookAdmission();
    });
    it('normalizes the same filename before comparing requests', () => {
        const middleware = guard();
        const first = response();
        middleware(request('owner-a', 'BOOK.PDF'), first, vi.fn());
        const second = response();
        middleware(request('owner-a', 'book.pdf'), second, vi.fn());
        expect(second.status).toHaveBeenCalledWith(409);
        first.locals.releaseAudiobookAdmission();
    });
    it('does not collide different owners or books', () => {
        const middleware = guard();
        const next = vi.fn();
        const results = [response(), response(), response()];
        middleware(request(), results[0], next);
        middleware(request('owner-b'), results[1], next);
        middleware(request('owner-a', 'other.pdf'), results[2], next);
        expect(next).toHaveBeenCalledTimes(3);
        results.forEach((res) => res.locals.releaseAudiobookAdmission());
    });
    it('releases admission after a synchronous controller failure', () => {
        const middleware = guard();
        expect(() => middleware(request(), response(), () => { throw new Error('test'); })).toThrow('test');
        const next = vi.fn();
        const res = response();
        middleware(request(), res, next);
        expect(next).toHaveBeenCalledOnce();
        res.locals.releaseAudiobookAdmission();
    });
    it.each([undefined, '', {}, 1])('rejects invalid filenames before admission: %s', (fileName) => {
        const middleware = guard();
        const res = response();
        const next = vi.fn();
        middleware({ user: { id: 'owner-a' }, body: { fileName } }, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });
    it('requires authentication independently of UI source selection', () => {
        const res = response();
        guard()({ body: { fileName: 'book.pdf' } }, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
