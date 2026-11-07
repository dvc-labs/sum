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

function carriesRequestContext(error) {
  const seen = new Set();
  for (let current = error; current && typeof current === 'object' && !seen.has(current); current = current.cause) {
    if (['url', 'requestBody', 'request', 'response', 'headers', 'input'].some((key) => key in current) ||
        Number.isInteger(current.status) || Number.isInteger(current.statusCode) ||
        Number.isInteger(current.$metadata?.httpStatusCode) ||
        (typeof current.name === 'string' && /^(?:DiscordAPIError|HTTPError|RateLimitError)\b/.test(current.name))) return true;
    seen.add(current);
  }
  return false;
}

function localDiagnostic(value) {
  if (typeof value === 'string') {
    return value.replace(/(\/(?:interactions|webhooks)\/\d+\/)[a-zA-Z0-9_.-]+/g, '$1[redacted]');
  }
}

/** Request errors can carry credentials. Local exceptions retain their diagnostics. */
export function errorDetails(error) {
  const { name, code } = error ?? {};
  const status = error?.status ?? error?.statusCode ?? error?.$metadata?.httpStatusCode;
  const safeLabel = (value) => typeof value === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(value);
  const type = typeof name === 'string' ? name.split('[')[0] : undefined;
  const details = {
    type: safeLabel(type) ? type : 'Error',
    status: Number.isInteger(status) ? status : undefined,
    code: Number.isInteger(code) || safeLabel(code) ? code : undefined,
  };
  if (carriesRequestContext(error)) return details;
  return { ...details, message: localDiagnostic(error?.message), stack: localDiagnostic(error?.stack) };
}
