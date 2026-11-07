import { errorDetails, logger } from './logger.js';

let webhookUrl;
let lastSent = 0;

export function initErrorReporting(url) {
  webhookUrl = url;
}

/** Logs an error and (optionally) forwards a short summary to the operator's webhook. */
export function reportError(err, { where, guildId } = {}) {
  const error = errorDetails(err);
  logger.error({ error, where, guildId }, 'Sum operation failed');
  if (!webhookUrl) return;
  const now = Date.now();
  if (now - lastSent < 10_000) return; // at most one alert per 10 s
  lastSent = now;
  const operation = where?.replace(/[^a-zA-Z0-9_ :.-]/g, '').slice(0, 80);
  const summary = `**Sum error**${operation ? ` in \`${operation}\`` : ''}\n\`${JSON.stringify(error)}\``;
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: summary, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

/** Discord error codes that mean "Sum lacks permission/access here". */
export function isPermissionError(err) {
  return err?.code === 50013 || err?.code === 50001;
}
