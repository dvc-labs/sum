import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info',
  base: { app: 'sum' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['token', '*.token', 'headers.authorization', 'secretAccessKey', '*.secretAccessKey'],
    censor: '[redacted]',
  },
});
