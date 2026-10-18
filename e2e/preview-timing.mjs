// Diagnostic proposal only. Never intercept bodies or modify request headers.
export function classifyPreviewRequest(method, rawPath) {
  if (method !== 'GET' || typeof rawPath !== 'string') return null;
  const path = rawPath.split('?')[0];
  if (path === '/' || /^\/notebook\/[^/]+$/.test(path)) return 'document';
  if (/^\/assets\/[^/]+\.js$/.test(path)) return 'script';
  if (/^\/assets\/[^/]+\.css$/.test(path)) return 'style';
  if (path === '/api/user/profile') return 'profile';
  if (path === '/api/notebooks') return 'notebook-list';
  if (/^\/api\/notebooks\/[^/]+\/sources$/.test(path)) return 'source-list';
  if (/^\/api\/notebooks\/[^/]+\/studio\/podcasts\/[^/]+\/audio$/.test(path)) return 'podcast-audio';
  return null;
}

export function createPreviewTiming({ enabled = false, sink = record => process.stderr.write(`${JSON.stringify(record)}\n`),
  now = () => performance.now(), wall = () => Date.now(), lifetimeMs = 300000,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let active = enabled === true;
  let ordinal = 0;
  const states = new WeakMap();
  const cleanups = new Set();
  const started = now();
  const finite = value => Number.isFinite(value) ? Math.max(0, Math.round(value * 1000) / 1000) : 0;
  function emit(state, stage, status = 0) {
    if (!active) return;
    // Build every field explicitly; never spread request, URL, header, or error data.
    const record = Object.freeze({ kind: 'preview-timing', request: state.id, route: state.route, stage,
      wallMs: finite(wall()), sinceStartMs: finite(now() - started), elapsedMs: finite(now() - state.started),
      httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0 });
    try { sink(record); } catch { /* Observation cannot fail a request. */ }
  }
  function listen(emitter, event, callback, removals) {
    emitter.on(event, callback);
    removals.push(() => emitter.removeListener(event, callback));
  }
  function middleware(req, res, next) {
    const route = active && ordinal < 2000 ? classifyPreviewRequest(req.method, req.url) : null;
    if (!route) return next();
    const state = { id: ++ordinal, route, started: now(), removals: [] };
    states.set(req, state);
    const cleanup = () => { state.removals.splice(0).forEach(remove => remove()); cleanups.delete(cleanup); states.delete(req); };
    cleanups.add(cleanup);
    listen(res, 'finish', () => { emit(state, 'client-finish', res.statusCode); cleanup(); }, state.removals);
    listen(res, 'close', () => { emit(state, 'client-close', res.statusCode); cleanup(); }, state.removals);
    emit(state, 'ingress');
    next();
  }
  function configureProxy(proxy) {
    if (!active) return;
    const removals = [];
    listen(proxy, 'proxyReq', (_upstreamRequest, req) => {
      const state = states.get(req); if (state) emit(state, 'upstream-dispatch');
    }, removals);
    listen(proxy, 'proxyRes', (upstream, req) => {
      const state = states.get(req); if (!state) return;
      emit(state, 'upstream-headers', upstream.statusCode);
      listen(upstream, 'end', () => emit(state, 'upstream-end', upstream.statusCode), state.removals);
      listen(upstream, 'aborted', () => emit(state, 'upstream-aborted', upstream.statusCode), state.removals);
    }, removals);
    listen(proxy, 'error', (_error, req) => {
      const state = states.get(req); if (state) emit(state, 'upstream-error');
    }, removals);
    const cleanup = () => { removals.splice(0).forEach(remove => remove()); cleanups.delete(cleanup); };
    cleanups.add(cleanup);
  }
  let timer;
  function stop() { active = false; if (timer !== undefined) cancel(timer); for (const cleanup of [...cleanups]) cleanup(); }
  if (active) {
    const bounded = Number.isFinite(lifetimeMs) ? Math.min(1800000, Math.max(1000, lifetimeMs)) : 300000;
    timer = schedule(stop, bounded); timer?.unref?.();
  }
  return { middleware, configureProxy, stop, plugin: {
    name: 'studypod-preview-timing',
    configurePreviewServer(server) {
      if (!active) return;
      server.middlewares.use(middleware);
      server.httpServer?.once('close', stop);
    },
  } };
}

export function previewTimingFromEnvironment(env = process.env) {
  return createPreviewTiming({ enabled: env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1' && env.STUDYPOD_PREVIEW_TIMING === '1',
    lifetimeMs: /^\d{1,10}$/.test(env.STUDYPOD_PREVIEW_TIMING_LIFETIME_MS || '') ? Number(env.STUDYPOD_PREVIEW_TIMING_LIFETIME_MS) : 300000 });
}
