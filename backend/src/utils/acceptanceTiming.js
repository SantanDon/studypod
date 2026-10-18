import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const phases = new Set(['auth-lookup', 'profile-lookup', 'profile-reset', 'owner', 'schema', 'multipart', 'source-owner', 'validate', 'blob-insert', 'read', 'copy']);
export function classifyAcceptanceRoute(method, path) {
  if (method === 'GET' && (path === '/health' || path === '/api/health')) return 'health';
  if (method === 'GET' && path === '/api/user/profile') return 'profile';
  if (method === 'POST' && /^\/api\/notebooks\/[^/]+\/studio\/podcasts$/.test(path)) return 'podcast-upload';
  if (method === 'GET' && /^\/api\/notebooks\/[^/]+\/studio\/podcasts\/[^/]+\/audio$/.test(path)) return 'podcast-audio';
  if (method === 'GET' && /^\/api\/notebooks\/[^/]+\/sources$/.test(path)) return 'source-list';
  return null;
}
const bounded = (value, max) => Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : 0;
export function createAcceptanceTiming({ enabled = false, sink = line => process.stderr.write(`${JSON.stringify(line)}\n`), now = () => performance.now(), lifetimeMs = 300000, intervalMs = 1000, loopFactory = monitorEventLoopDelay, utilization = previous => performance.eventLoopUtilization(previous), schedule = setInterval, unschedule = clearInterval, expire = setTimeout, unexpire = clearTimeout } = {}) {
  const context = new AsyncLocalStorage();
  let active = enabled === true, counter = 0, interval, expiry, histogram, previous;
  const emit = record => { if (active) { try { sink(Object.freeze(record)); } catch { /* Observability cannot fail a request. */ } } };
  const elapsed = start => Math.round(Math.max(0, now() - start) * 100) / 100;
  function measure(phase, operation, metrics = {}) {
    const request = active && context.getStore();
    if (!request || !phases.has(phase)) return operation();
    const start = now();
    // Read only these numeric keys. Never spread caller data into a record.
    const bytes = bounded(metrics.bytes, 50 * 1024 * 1024), count = bounded(metrics.count, 1000);
    const done = status => emit({ kind: 'phase', request: request.counter, route: request.route, phase, status, bytes, count, elapsedMs: elapsed(start) });
    try {
      const result = operation();
      if (result && typeof result.then === 'function') return result.then(value => { done('ok'); return value; }, error => { done('failed'); throw error; });
      done('ok'); return result;
    } catch (error) { done('failed'); throw error; }
  }
  function middleware(req, res, next) {
    if (!active) return next();
    const route = classifyAcceptanceRoute(req.method, req.path);
    if (!route) return next();
    const request = { counter: ++counter, route }, start = now();
    emit({ kind: 'request', request: request.counter, route, phase: 'ingress', status: 'started', elapsedMs: 0 });
    let completed = false;
    const finish = closed => {
      if (completed) return;
      completed = true;
      res.removeListener('finish', onFinish); res.removeListener('close', onClose);
      emit({ kind: 'request', request: request.counter, route, phase: 'response', status: closed ? 'closed' : 'finished', httpStatus: bounded(res.statusCode, 599), elapsedMs: elapsed(start) });
    };
    const onFinish = () => finish(false), onClose = () => finish(true);
    res.once('finish', onFinish); res.once('close', onClose);
    return context.run(request, next);
  }
  function stop() {
    active = false;
    if (interval !== undefined) unschedule(interval);
    if (expiry !== undefined) unexpire(expiry);
    histogram?.disable();
  }
  if (active) {
    histogram = loopFactory({ resolution: 20 }); histogram.enable(); previous = utilization();
    interval = schedule(() => {
      const current = utilization(previous); previous = utilization();
      emit({ kind: 'event-loop', phase: 'sample', status: 'sampled', elapsedMs: bounded(histogram.max / 1e6, 1800000), p99Ms: bounded(histogram.percentile(99) / 1e6, 1800000), utilization: Number.isFinite(current.utilization) ? Math.max(0, Math.min(1, current.utilization)) : 0 });
      histogram.reset();
    }, Math.max(1000, Math.min(10000, intervalMs)));
    interval?.unref?.();
    expiry = expire(stop, Math.max(1000, Math.min(1800000, lifetimeMs))); expiry?.unref?.();
  }
  return { middleware, measure, stop };
}
let installed;
export function parseAcceptanceTimingLifetime(value) {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return 300000;
  const parsed = Number(value);
  return Math.max(1000, Math.min(1800000, parsed));
}
export function installAcceptanceTiming(app) {
  if (process.env.STUDYPOD_ACCEPTANCE_TIMING !== '1') return;
  installed?.stop();
  installed = createAcceptanceTiming({ enabled: true, lifetimeMs: parseAcceptanceTimingLifetime(process.env.STUDYPOD_ACCEPTANCE_TIMING_LIFETIME_MS) });
  app.use(installed.middleware);
}
export function measureAcceptancePhase(phase, operation, metrics) {
  return installed ? installed.measure(phase, operation, metrics) : operation();
}
