// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request } from 'node:http';
import jwt from 'jsonwebtoken';
import { createServer } from 'vite';

vi.mock('../db/database.js', () => ({ dbHelpers: { getUserById: vi.fn().mockResolvedValue({ id: 'foreign' }) }, getDatabase: vi.fn() }));
const { createPodcastRouter } = await import('../routes/podcasts.js');
const resources = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

function upload(url, token, body, chunked) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, connection: 'close',
      'content-type': 'multipart/form-data; boundary=transport-boundary',
      ...(chunked ? {} : { 'content-length': String(body.length) }),
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (!chunked) return req.end(body);
    let offset = 0;
    const writeChunk = () => {
      if (offset === body.length) return req.end();
      const end = Math.min(offset + 4096, body.length);
      req.write(body.subarray(offset, end));
      offset = end;
      setTimeout(writeChunk, 1);
    };
    writeChunk();
  });
}

describe('podcast multipart denial through the preview proxy', () => {
  it.each([
    { name: 'large content-length upload', bytes: 8 * 1024 * 1024, chunked: false },
    { name: 'streaming chunked upload', bytes: 64 * 1024, chunked: true },
  ])('preserves the owner-denial response for $name', async ({ bytes, chunked }) => {
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'transport-regression-test-secret-more-than-32-chars';
    resources.push(async () => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
    const denied = Object.assign(new Error('Podcast not found or access denied.'), { code: 'PODCAST_NOT_FOUND' });
    const repository = { assertOwner: vi.fn().mockRejectedValue(denied), create: vi.fn() };
    const app = express();
    app.use('/api/notebooks', createPodcastRouter(repository));
    const backend = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    resources.push(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve); }));
    const proxy = await createServer({ configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${backend.address().port}` } }, optimizeDeps: { noDiscovery: true, include: [] } });
    await proxy.listen();
    resources.push(() => proxy.close());
    const token = jwt.sign({ userId: 'foreign' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    const body = Buffer.concat([
      Buffer.from('--transport-boundary\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}\r\n--transport-boundary\r\nContent-Disposition: form-data; name="audio"; filename="episode.wav"\r\nContent-Type: audio/wav\r\n\r\n'),
      Buffer.alloc(bytes), Buffer.from('\r\n--transport-boundary--\r\n'),
    ]);
    const response = await upload(`http://127.0.0.1:${proxy.httpServer.address().port}/api/notebooks/book/studio/podcasts`, token, body, chunked);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: denied.message, code: 'PODCAST_NOT_FOUND' });
    expect(repository.assertOwner).toHaveBeenCalledWith('book', 'foreign');
    expect(repository.create).not.toHaveBeenCalled();
  });
});
