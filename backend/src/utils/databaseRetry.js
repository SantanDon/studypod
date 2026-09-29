import { logger } from './logger.js';

const FALLBACK_ATTEMPTS = 3;
const FALLBACK_BASE_DELAY_MS = 250;
// Hard bounds keep a malformed caller/env value from skipping the operation
// (NaN -> zero attempts -> throw undefined) or stalling the worker forever.
const MAX_ATTEMPTS = 10;
const MAX_BASE_DELAY_MS = 5_000;
const MAX_SLEEP_MS = 5_000;

// Bounds apply to the retry count and backoff delays only, not to a
// wall-clock timeout of the operation itself: a slow-but-running operation is
// never interrupted by this helper.
//
// Accepted input types are finite numbers and non-blank numeric strings.
// Anything else (objects with user-defined coercion, Symbols, booleans,
// bigints, blank strings, null/undefined) uses the documented fallback
// (the call-site default), so a malformed options value can neither skip the
// operation nor request unbounded retries. In particular, blank env values
// behave like unset defaults instead of selecting zero.
function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoundedAttempts(value, fallback) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return fallback;
  return Math.min(MAX_ATTEMPTS, Math.max(1, Math.floor(parsed)));
}

function toBoundedDelay(value, fallback) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return fallback;
  return Math.min(MAX_BASE_DELAY_MS, Math.max(0, Math.floor(parsed)));
}

const DEFAULT_ATTEMPTS = toBoundedAttempts(
  process.env.DATABASE_READ_RETRY_ATTEMPTS,
  FALLBACK_ATTEMPTS,
);
const DEFAULT_BASE_DELAY_MS = toBoundedDelay(
  process.env.DATABASE_READ_RETRY_DELAY_MS,
  FALLBACK_BASE_DELAY_MS,
);

export function isTransientDatabaseError(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  return [
    'SQLITE_UNKNOWN',
    'SQLITE_BUSY',
    'SQLITE_LOCKED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ].includes(code)
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('socket')
    || message.includes('timeout')
    || message.includes('temporarily unavailable');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry(operation, {
  label = 'database read',
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
} = {}) {
  if (typeof operation !== 'function') {
    throw new TypeError('withDatabaseRetry requires an operation function');
  }
  // Deliberate invalid-input semantics: only finite numbers and non-blank
  // numeric strings are coerced; anything else falls back to defaults.
  // Fractional values are floored; totals are clamped to 1..MAX_ATTEMPTS
  // attempts and 0..MAX_BASE_DELAY_MS base delay so a bad caller can neither
  // skip the operation nor request unbounded retries.
  const totalAttempts = toBoundedAttempts(attempts, DEFAULT_ATTEMPTS);
  const boundedBaseDelay = toBoundedDelay(baseDelayMs, DEFAULT_BASE_DELAY_MS);
  let lastError;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt >= totalAttempts) throw error;
      // An explicit zero base delay retries without jitter and without
      // creating a wait timer; iterations are already capped above.
      let sleepMs = 0;
      if (boundedBaseDelay > 0) {
        const backoff = Math.min(
          MAX_SLEEP_MS,
          boundedBaseDelay * (2 ** (attempt - 1)),
        );
        const jitter = Math.floor(Math.random() * Math.max(25, boundedBaseDelay));
        sleepMs = Math.min(MAX_SLEEP_MS, backoff + jitter);
      }
      logger.warn(`[Database] ${label} transient failure; retrying ${attempt + 1}/${totalAttempts} in ${sleepMs}ms (${error?.code || error?.cause?.code || error?.message})`);
      if (sleepMs > 0) await delay(sleepMs);
    }
  }
  throw lastError;
}

export default withDatabaseRetry;
