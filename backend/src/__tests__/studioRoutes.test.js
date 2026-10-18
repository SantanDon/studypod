// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Only account lookup is isolated; the real signature/session middleware runs.
const helpers = vi.hoisted(() => ({ getUserById: vi.fn(), getApiKeyByHash: vi.fn(), touchApiKey: vi.fn() }));
vi.mock('../db/database.js', () => ({ dbHelpers: helpers }));
const { createStudioRouter } = await import('../routes/studio.js');
const secret = 'studio-test-only-secret-with-more-than-32-characters';
let oldSecret;
beforeEach(() => { oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = secret; vi.clearAllMocks(); helpers.getUserById.mockResolvedValue({ id: 'session-owner' }); });
afterEach(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
function dispatch(router, { token, cookies, body = {}, method = 'POST', url = '/book/studio/decks' } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, cookies, body };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); return this; } };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}
const session = claims => jwt.sign({ userId: 'session-owner', ...claims }, secret, { algorithm: 'HS256' });

describe('Studio routes session and contract boundary without a listening server', () => {
  it('rejects absent, guest, invalid, refresh and API credentials before writes', async () => {
    const createDeck = vi.fn(), router = createStudioRouter({ createDeck });
    expect((await dispatch(router)).status).toBe(401);
    expect((await dispatch(router, { token: 'guest_abcdefghijklmnop' })).status).toBe(403);
    expect((await dispatch(router, { token: 'invalid' })).status).toBe(403);
    expect((await dispatch(router, { token: session({ type: 'refresh' }) })).status).toBe(403);
    helpers.getApiKeyByHash.mockResolvedValue({ id: 'api', userId: 'session-owner', scopes: '["notebooks:write"]' });
    expect((await dispatch(router, { token: 'spm_fake_test_credential' })).status).toBe(403);
    expect(createDeck).not.toHaveBeenCalled();
  });
  it('derives ownership from a signed cookie session and ignores body owner identity', async () => {
    const createDeck = vi.fn().mockResolvedValue({ id: 'deck', version: 1 }), router = createStudioRouter({ createDeck });
    const body = { name: 'Deck', cards: [], userId: 'attacker' };
    expect(await dispatch(router, { token: 'COOKIE_SESSION', cookies: { accessToken: session() }, body })).toEqual({ status: 201, body: { deck: { id: 'deck', version: 1 } } });
    expect(createDeck).toHaveBeenCalledWith('book', 'session-owner', body);
  });
  it('maps stale saves and malformed payloads into actionable errors', async () => {
    const updateDeck = vi.fn().mockRejectedValue(Object.assign(new Error('Reload before saving.'), { code: 'STUDIO_VERSION_CONFLICT', currentVersion: 3 }));
    const createDeck = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid cards.'), { code: 'STUDIO_INVALID_PAYLOAD' }));
    const router = createStudioRouter({ updateDeck, createDeck });
    expect(await dispatch(router, { token: session(), method: 'PUT', url: '/book/studio/decks/deck' })).toEqual({ status: 409, body: { error: 'Reload before saving.', code: 'STUDIO_VERSION_CONFLICT', currentVersion: 3 } });
    expect((await dispatch(router, { token: session() })).status).toBe(422);
  });
  it('scopes map creation, reads and deletion to the verified session and notebook', async () => {
    const map = { id: 'map', title: 'Saved map', nodes: [], edges: [] };
    const repository = {
      createMap: vi.fn().mockResolvedValue(map),
      listMaps: vi.fn().mockResolvedValue([map]),
      getMap: vi.fn().mockResolvedValue(map),
      deleteMap: vi.fn().mockResolvedValue({ success: true }),
    };
    const router = createStudioRouter(repository);
    const body = { ...map, userId: 'foreign-owner', notebookId: 'foreign-book' };
    expect((await dispatch(router, { url: '/book/studio/maps', body })).status).toBe(401);
    expect(repository.createMap).not.toHaveBeenCalled();
    const credentials = { cookies: { accessToken: session() } };
    expect(await dispatch(router, { ...credentials, url: '/book/studio/maps', body })).toEqual({ status: 201, body: { map } });
    expect(repository.createMap).toHaveBeenCalledWith('book', 'session-owner', body);
    expect(await dispatch(router, { ...credentials, method: 'GET', url: '/book/studio/maps' })).toEqual({ status: 200, body: { maps: [map] } });
    expect(repository.listMaps).toHaveBeenCalledWith('book', 'session-owner');
    expect(await dispatch(router, { ...credentials, method: 'GET', url: '/book/studio/maps/map' })).toEqual({ status: 200, body: { map } });
    expect(repository.getMap).toHaveBeenCalledWith('book', 'session-owner', 'map');
    expect(await dispatch(router, { ...credentials, method: 'DELETE', url: '/book/studio/maps/map' })).toEqual({ status: 200, body: { success: true } });
    expect(repository.deleteMap).toHaveBeenCalledWith('book', 'session-owner', 'map');
    repository.getMap.mockRejectedValueOnce(Object.assign(new Error('Map not found.'), { code: 'STUDIO_NOT_FOUND' }));
    expect((await dispatch(router, { ...credentials, method: 'GET', url: '/other/studio/maps/map' })).status).toBe(404);
  });
});
