type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = '[AI]' | '[Search]' | '[Storage]' | '[Auth]' | '[API]' | '[UI]' | string;

interface TimingEntry {
  label: string;
  start: number;
}

const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';

const timings = new Map<string, TimingEntry>();

const shouldLog = (level: LogLevel): boolean => {
  if (isDev) return true;
  return level === 'warn' || level === 'error';
};

const formatArgs = (context: LogContext | undefined, args: unknown[]): unknown[] => {
  const timestamp = new Date().toISOString();
  const prefix = context ? `${timestamp} ${context}` : timestamp;
  return [prefix, ...args];
};

export const logger = {
  debug(context: LogContext, ...args: unknown[]): void;
  debug(...args: unknown[]): void;
  debug(...args: unknown[]): void {
    if (!shouldLog('debug')) return;
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.startsWith('[')) {
      console.debug(...formatArgs(first as LogContext, rest));
    } else {
      console.debug(...formatArgs(undefined, args));
    }
  },

  info(context: LogContext, ...args: unknown[]): void;
  info(...args: unknown[]): void;
  info(...args: unknown[]): void {
    if (!shouldLog('info')) return;
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.startsWith('[')) {
      console.info(...formatArgs(first as LogContext, rest));
    } else {
      console.info(...formatArgs(undefined, args));
    }
  },

  warn(context: LogContext, ...args: unknown[]): void;
  warn(...args: unknown[]): void;
  warn(...args: unknown[]): void {
    if (!shouldLog('warn')) return;
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.startsWith('[')) {
      console.warn(...formatArgs(first as LogContext, rest));
    } else {
      console.warn(...formatArgs(undefined, args));
    }
  },

  error(context: LogContext, ...args: unknown[]): void;
  error(...args: unknown[]): void;
  error(...args: unknown[]): void {
    if (!shouldLog('error')) return;
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.startsWith('[')) {
      console.error(...formatArgs(first as LogContext, rest));
    } else {
      console.error(...formatArgs(undefined, args));
    }
  },

  group(label: string): void {
    if (!isDev) return;
    console.group(label);
  },

  groupEnd(): void {
    if (!isDev) return;
    console.groupEnd();
  },

  time(label: string): void {
    if (!isDev) return;
    timings.set(label, { label, start: performance.now() });
  },

  timeEnd(label: string): void {
    if (!isDev) return;
    const entry = timings.get(label);
    if (entry) {
      const duration = performance.now() - entry.start;
      console.debug(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
      timings.delete(label);
    }
  },

  timeLog(label: string, ...args: unknown[]): void {
    if (!isDev) return;
    const entry = timings.get(label);
    if (entry) {
      const duration = performance.now() - entry.start;
      console.debug(`⏱️ ${label}: ${duration.toFixed(2)}ms`, ...args);
    }
  },

  measure<T>(label: string, fn: () => T): T {
    if (!isDev) return fn();
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    console.debug(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
    return result;
  },

  async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!isDev) return fn();
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    console.debug(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
    return result;
  },
};

export default logger;
