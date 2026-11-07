import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info',
  base: { app: 'sum' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'token', '*.token', 'headers.authorization', 'secretAccessKey', '*.secretAccessKey',
      'err.url', 'err.requestBody', 'err.rawError',
    ],
    censor: '[redacted]',
  },
});

/** Discord REST errors can carry interaction tokens in URLs and complete request bodies. */
export function errorDetails(error) {
  const { name, status, code } = error ?? {};
  const safeLabel = (value) => typeof value === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(value);
  return {
    type: safeLabel(name) ? name : 'Error',
    status: Number.isInteger(status) ? status : undefined,
    code: Number.isInteger(code) || safeLabel(code) ? code : undefined,
  };
}
