import express from 'express';
import multer from 'multer';
import { authenticateToken, requireSessionCredential } from '../middleware/auth.js';
import { MAX_PODCAST_BYTES, podcastRepository } from '../services/podcastRepository.js';
import { createPodcastChunkRepository, PODCAST_CHUNK_BYTES } from '../services/podcastChunkRepository.js';
import { logger } from '../utils/logger.js';

// A rejected multipart upload can still be in flight through a reverse proxy.
// Finish discarding its bounded body before closing the upstream response, so
// the proxy can deliver the ownership error instead of a socket-reset 500.
const discardRejectedUpload = req => new Promise(resolve => {
  if (!['POST', 'PUT'].includes(req.method) || req.readableEnded || !req.on || !req.resume) return resolve();
  let received = 0;
  const finish = () => {
    clearTimeout(timer);
    req.removeListener('data', onData);
    req.removeListener('end', finish);
    req.removeListener('aborted', finish);
    req.removeListener('error', finish);
    resolve();
  };
  const onData = chunk => {
    received += chunk.length;
    if (received > MAX_PODCAST_BYTES + 1024 * 1024) finish();
  };
  const timer = setTimeout(finish, 15000);
  timer.unref?.();
  req.on('data', onData);
  req.once('end', finish);
  req.once('aborted', finish);
  req.once('error', finish);
  req.resume();
});

export function createPodcastRouter(repository = podcastRepository, transfers = createPodcastChunkRepository({ repository })) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PODCAST_BYTES, files: 1, fields: 1, fieldSize: 600 * 1024, parts: 2 } }).single('audio');
  const args = req => [req.params.id, req.user.userId || req.user.id];
  const errorResponse = (error, res) => {
    const status = { PODCAST_NOT_FOUND: 404, PODCAST_INVALID_PAYLOAD: 422, PODCAST_CONFLICT: 409 }[error.code] || (error instanceof multer.MulterError || error.type === 'entity.too.large' ? 422 : 500);
    if (status === 500) logger.error('[Podcast] Operation failed:', error);
    return res.status(status).json({ error: status === 500 ? 'Podcast operation failed.' : status === 422 && error instanceof multer.MulterError ? 'Podcast upload exceeds supported limits.' : error.message, code: status === 500 ? 'PODCAST_OPERATION_FAILED' : error instanceof multer.MulterError ? 'PODCAST_INVALID_PAYLOAD' : error.code });
  };
  const run = operation => async (req, res) => { try { await operation(req, res); } catch (error) { errorResponse(error, res); } };
  router.use(authenticateToken, requireSessionCredential);
  router.get('/studio/podcasts/recent', run(async (req, res) => res.json({ podcast: await repository.recent(req.user.userId || req.user.id) })));
  // Explicit owner middleware completes before multer reads any untrusted audio.
  router.use('/:id/studio/podcasts', async (req, res, next) => { try { await repository.assertOwner(...args(req)); next(); } catch (error) {
    await discardRejectedUpload(req);
    errorResponse(error, res);
  } });
  const parse = parser => (req,res,next) => parser(req,res,error => error ? errorResponse(Object.assign(error,{code:'PODCAST_INVALID_PAYLOAD'}),res) : next());
  router.post('/:id/studio/podcasts/uploads', parse(express.json({limit:'600kb'})), run(async(req,res) => res.status(201).json(await transfers.start(...args(req),req.body))));
  router.put('/:id/studio/podcasts/uploads/:uploadId/chunks/:index', parse(express.raw({type:'application/octet-stream',limit:PODCAST_CHUNK_BYTES})), run(async(req,res) => res.json(await transfers.put(...args(req),req.params.uploadId,req.params.index,req.body))));
  router.get('/:id/studio/podcasts/:podcastId/audio/chunks/:index', run(async(req,res) => { const audio=await transfers.read(...args(req),req.params.podcastId,req.params.index); res.set({'Content-Type':'application/octet-stream','Content-Length':String(audio.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','ETag':`"${audio.hash}"`}); res.send(audio.bytes); }));
  // Four full 512 KiB scripts plus metadata fit comfortably below the hosted response limit.
  router.get('/:id/studio/podcasts', run(async (req, res) => {
    let cursor;
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(req.query.cursor)) throw new Error();
        cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || cursor[0].length > 64 || !Number.isFinite(Date.parse(cursor[0])) || typeof cursor[1] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor[1])) throw new Error();
      } catch { throw Object.assign(new Error('Invalid podcast history cursor.'), {code:'PODCAST_INVALID_PAYLOAD'}); }
    }
    const records = await repository.list(...args(req), {cursor});
    const podcasts = records.slice(0,4);
    const last = podcasts.at(-1);
    res.json({podcasts, ...(records.length > 4 ? {nextCursor:Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url')} : {})});
  }));
  router.post('/:id/studio/podcasts', parse(express.json({limit:'2kb'})), async(req,res,next) => { if(!req.is('application/json')) return next(); try { res.status(201).json({podcast:await transfers.complete(...args(req),req.body?.uploadId)}); } catch(error) { errorResponse(error,res); } });
  router.post('/:id/studio/podcasts', (req, res, next) => upload(req, res, error => error ? errorResponse(error, res) : next()), run(async (req, res) => {
    let metadata;
    try { metadata = JSON.parse(req.body?.metadata); } catch { throw Object.assign(new Error('Podcast metadata must be JSON.'), { code: 'PODCAST_INVALID_PAYLOAD' }); }
    if (!req.file || !['audio/wav', 'audio/x-wav', 'audio/wave'].includes(req.file.mimetype)) throw Object.assign(new Error('A WAV audio upload is required.'), { code: 'PODCAST_INVALID_PAYLOAD' });
    res.status(201).json({ podcast: await repository.create(...args(req), metadata, req.file.buffer) });
  }));
  router.get('/:id/studio/podcasts/:podcastId', run(async (req, res) => res.json({ podcast: await repository.get(...args(req), req.params.podcastId) })));
  router.get('/:id/studio/podcasts/:podcastId/audio', run(async (req, res) => { const audio = await transfers.audio(...args(req), req.params.podcastId); res.set({ 'Content-Type': 'audio/wav', 'Content-Length': String(audio.bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'ETag': `"${audio.hash}"` }); res.send(audio.bytes); }));
  router.delete('/:id/studio/podcasts/:podcastId', run(async (req, res) => res.json(await transfers.delete(...args(req), req.params.podcastId))));
  return router;
}
export default createPodcastRouter();
