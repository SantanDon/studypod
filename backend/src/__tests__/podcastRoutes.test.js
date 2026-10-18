// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { Readable } from 'node:stream';

const helpers = vi.hoisted(() => ({ getUserById: vi.fn(), getApiKeyByHash: vi.fn(), touchApiKey: vi.fn() }));
vi.mock('../db/database.js', () => ({ dbHelpers: helpers, getDatabase: vi.fn() }));
const { createPodcastRouter } = await import('../routes/podcasts.js');
const secret = 'podcast-test-only-secret-with-more-than-32-characters';
let oldSecret;
beforeEach(() => { oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = secret; vi.clearAllMocks(); helpers.getUserById.mockResolvedValue({ id: 'owner' }); });
afterEach(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
const session = claims => jwt.sign({ userId: 'owner', ...claims }, secret, { algorithm: 'HS256' });
function dispatch(router, { method = 'GET', url = '/book/studio/podcasts', token, cookies, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // Deliberately not a stream: denied POST must finish before the upload parser.
    const req = Object.assign(body ? Readable.from([body]) : {}, { method, url, originalUrl: url, query: Object.fromEntries(new URL(url,'http://offline.invalid').searchParams), is: express.request.is, headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, cookies });
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; }, set(value) { this.headers = value; return this; }, send(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; } };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}
describe('podcast authenticated HTTP boundary', () => {
  it('authenticates owner-wide recent metadata without accepting a notebook id', async () => {
    const recent = vi.fn().mockResolvedValue({ id: 'episode', notebook_id: 'book', persistence: 'account' });
    const assertOwner = vi.fn();
    const router = createPodcastRouter({ recent, assertOwner });
    const url = '/studio/podcasts/recent';
    expect((await dispatch(router, { url })).status).toBe(401);
    expect((await dispatch(router, { url, token: session({ type: 'refresh' }) })).status).toBe(403);
    expect(recent).not.toHaveBeenCalled();
    expect(await dispatch(router, { url, cookies: { accessToken: session() } })).toEqual({ status: 200, body: { podcast: { id: 'episode', notebook_id: 'book', persistence: 'account' } } });
    expect(recent).toHaveBeenCalledExactlyOnceWith('owner');
    expect(assertOwner).not.toHaveBeenCalled();
  });
  it('rejects unsigned, guest and refresh credentials before ownership or upload', async () => {
    const assertOwner = vi.fn(), create = vi.fn(), router = createPodcastRouter({ assertOwner, create });
    for (const token of [undefined, 'guest_abcdefghijklmnop', 'invalid', session({ type: 'refresh' })]) expect((await dispatch(router, { method: 'POST', token })).status).toBe(token ? 403 : 401);
    expect(assertOwner).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('denies foreign notebook before parsing a multipart body', async () => {
    const assertOwner = vi.fn().mockRejectedValue(Object.assign(new Error('Podcast not found or access denied.'), { code: 'PODCAST_NOT_FOUND' })), create = vi.fn();
    const router = createPodcastRouter({ assertOwner, create });
    expect(await dispatch(router, { method: 'POST', token: session(), headers: { 'content-type': 'multipart/form-data; boundary=deliberately-invalid' } })).toEqual({ status: 404, body: { error: 'Podcast not found or access denied.', code: 'PODCAST_NOT_FOUND' } });
    expect(assertOwner).toHaveBeenCalledWith('book', 'owner'); expect(create).not.toHaveBeenCalled();
  });
  it('uses cookie identity for list, metadata, private audio and delete', async () => {
    const record = { id: 'episode', persistence: 'account' }, bytes = Buffer.from('validated by repository');
    const repository = { assertOwner: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([record]), get: vi.fn().mockResolvedValue(record), audio: vi.fn().mockResolvedValue({ bytes, hash: 'verified-hash' }), delete: vi.fn().mockResolvedValue({ success: true }) };
    const transfers = { audio: repository.audio, delete: repository.delete };
    const router = createPodcastRouter(repository, transfers), credentials = { cookies: { accessToken: session() } };
    expect(await dispatch(router, credentials)).toEqual({ status: 200, body: { podcasts: [record] } });
    expect(await dispatch(router, { ...credentials, url: '/book/studio/podcasts/episode' })).toEqual({ status: 200, body: { podcast: record } });
    const media = await dispatch(router, { ...credentials, url: '/book/studio/podcasts/episode/audio' });
    expect(media.body).toEqual(bytes); expect(media.headers).toMatchObject({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store', 'ETag': '"verified-hash"' });
    expect(await dispatch(router, { ...credentials, method: 'DELETE', url: '/book/studio/podcasts/episode' })).toEqual({ status: 200, body: { success: true } });
    for (const method of ['get', 'audio', 'delete']) expect(repository[method]).toHaveBeenCalledWith('book', 'owner', 'episode');
  });
  it('parses a bounded multipart audio upload and passes exact bytes with metadata', async () => {
    const metadata = { id: 'episode', title: 'Test', script: { segments: [] }, sourceIds: [] };
    const bytes = Buffer.from([0, 1, 2, 3, 255]);
    const body = Buffer.concat([Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--test-boundary\r\nContent-Disposition: form-data; name="audio"; filename="episode.wav"\r\nContent-Type: audio/wav\r\n\r\n`), bytes, Buffer.from('\r\n--test-boundary--\r\n')]);
    const repository = { assertOwner: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue({ id: 'episode' }) };
    const result = await dispatch(createPodcastRouter(repository), { method: 'POST', token: session(), body, headers: { 'content-type': 'multipart/form-data; boundary=test-boundary', 'content-length': String(body.length) } });
    expect(result).toEqual({ status: 201, body: { podcast: { id: 'episode' } } });
    expect(repository.create).toHaveBeenCalledWith('book', 'owner', metadata, bytes);
  });
});

describe('history route pages',()=>{
 const rows=Array.from({length:5},(_,i)=>({id:'00000000-0000-4000-8000-'+String(5-i).padStart(12,'0'),created_at:'2026-10-18T00:00:00.000Z',script:{segments:[{text:'x'.repeat(524000),speaker:'A'}]}}));
 it('returns four full scripts and reusable last-item cursor',async()=>{const list=vi.fn().mockResolvedValue(rows);const router=createPodcastRouter({assertOwner:vi.fn(),list},{});const result=await dispatch(router,{token:session({})});expect(result.status).toBe(200);expect(result.body.podcasts).toEqual(rows.slice(0,4));expect(Buffer.byteLength(JSON.stringify(result.body))).toBeLessThan(4500000);const cursor=result.body.nextCursor;expect(JSON.parse(Buffer.from(cursor,'base64url'))).toEqual([rows[3].created_at,rows[3].id]);await dispatch(router,{url:'/book/studio/podcasts?cursor='+cursor,token:session({})});expect(list).toHaveBeenLastCalledWith('book','owner',{cursor:[rows[3].created_at,rows[3].id]});});
 it('rejects malformed cursors before repository list',async()=>{const list=vi.fn();const router=createPodcastRouter({assertOwner:vi.fn(),list},{});for(const value of ['!','W10',Buffer.from(JSON.stringify(['bad','bad'])).toString('base64url')]){expect((await dispatch(router,{url:'/book/studio/podcasts?cursor='+value,token:session({})})).status).toBe(422);}expect(list).not.toHaveBeenCalled();});
});
