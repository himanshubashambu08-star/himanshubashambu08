import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(name: string) {
  return logger.child({ mod: name });
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
