export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  if (LEVELS[level] > LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] ${message}`;
  const args: unknown[] = meta === undefined ? [line] : [line, meta];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

export const logger = {
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
};
