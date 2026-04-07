/**
 * Structured Logger Utility
 *
 * Provides leveled logging with timestamps and environment-aware filtering.
 * Replaces ad-hoc console.log statements for consistent, debuggable output.
 *
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.info('Server started');
 *   logger.debug('Processing request:', req.id);
 *   logger.warn('Rate limit approaching');
 *   logger.error('Database connection failed:', error);
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Get log level from environment, default to INFO in production, DEBUG in dev
const currentLevel = process.env.LOG_LEVEL?.toUpperCase() ||
  (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');

const currentLevelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.INFO;

/**
 * Format log message with timestamp and level
 */
function formatMessage(level, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  return `${prefix} ${message}`;
}

/**
 * Logger object with level-filtered methods
 */
export const logger = {
  /**
   * Debug level - verbose logging for development
   * Suppressed in production unless LOG_LEVEL=DEBUG
   */
  debug: (...args) => {
    if (currentLevelValue >= LOG_LEVELS.DEBUG) {
      console.debug(formatMessage('DEBUG', ...args));
    }
  },

  /**
   * Info level - general application events
   * Always logged unless LOG_LEVEL=WARN or ERROR
   */
  info: (...args) => {
    if (currentLevelValue >= LOG_LEVELS.INFO) {
      console.info(formatMessage('INFO', ...args));
    }
  },

  /**
   * Warn level - potential issues that don't break functionality
   * Always logged unless LOG_LEVEL=ERROR
   */
  warn: (...args) => {
    if (currentLevelValue >= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', ...args));
    }
  },

  /**
   * Error level - actual errors that affect functionality
   * Always logged regardless of LOG_LEVEL
   */
  error: (...args) => {
    // Always log errors
    console.error(formatMessage('ERROR', ...args));
  },

  /**
   * Get current log level (for debugging logger config)
   */
  getLevel: () => currentLevel,

  /**
   * Check if a level would be logged (useful for expensive operations)
   */
  isLevelEnabled: (level) => {
    return currentLevelValue >= (LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO);
  }
};

/**
 * Express middleware to add request logging
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  logger.debug(`${req.method} ${req.path} - Request received`, {
    query: req.query,
    body: req.body ? '[REDACTED]' : undefined // Don't log sensitive body data at debug level
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
    );
  });

  next();
}
