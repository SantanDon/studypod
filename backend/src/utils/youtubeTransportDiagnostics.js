import { performance } from 'node:perf_hooks';

const CODES = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);
const PHASES = new Set(['player', 'caption', 'page', 'oembed', 'other', 'yt-dlp']);
export function transportFailureClass(error, subprocess = false) {
  if (subprocess && /CERTIFICATE_VERIFY_FAILED/.test(String(error?.stderr || '').slice(0, 16384))) return 'TLS_CERTIFICATE_VERIFY_FAILED';
  const seen = new Set();
  for (let current = error, depth = 0; current && depth < 6 && !seen.has(current); current = current.cause, depth += 1) {
    seen.add(current);
    if (CODES.has(current.code)) return current.code;
    if (current.name === 'AbortError') return 'ABORTED';
  }
  return 'OTHER';
}
export function transportPhase(url) {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.includes('/youtubei/') && pathname.endsWith('/player')) return 'player';
    if (pathname.endsWith('/timedtext')) return 'caption';
    if (pathname === '/watch') return 'page';
    if (pathname === '/oembed') return 'oembed';
  } catch { /* Unknown URL stays a fixed category; never emit the URL. */ }
  return 'other';
}
export function useAcceptanceSystemTrust(env = process.env) {
  return env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1'
    && env.STUDYPOD_YOUTUBE_TRANSPORT_DIAGNOSTICS === '1'
    && env.STUDYPOD_ACCEPTANCE_SYSTEM_CA === '1';
}
export function createTransportRecorder({ env = process.env, emit, now = () => performance.now() } = {}) {
  let sequence = 0;
  const enabled = env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1' && env.STUDYPOD_YOUTUBE_TRANSPORT_DIAGNOSTICS === '1';
  return {
    start: () => now(),
    finish(phase, started, { status = null, error = null } = {}) {
      if (!enabled || sequence >= 256) return;
      const elapsed = now() - started;
      const record = { event: 'youtube-transport', sequence: ++sequence,
        phase: PHASES.has(phase) ? phase : 'other',
        trust: useAcceptanceSystemTrust(env) ? 'system-trial' : 'default',
        outcome: error ? 'failure' : 'response',
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        failureClass: error ? transportFailureClass(error, phase === 'yt-dlp') : null,
        elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0 };
      try { emit?.(record); } catch { /* Diagnostics cannot change extraction behavior. */ }
    },
  };
}
export async function fetchWithTransportTimeout(url, options, timeoutMs, recorder,
  fetchImpl = globalThis.fetch, timers = { setTimeout, clearTimeout }) {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(), timeoutMs);
  const started = recorder.start();
  const phase = transportPhase(url);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    recorder.finish(phase, started, { status: response.status });
    return response;
  } catch (error) {
    recorder.finish(phase, started, { error });
    throw error;
  } finally { timers.clearTimeout(timer); }
}
