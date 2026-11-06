import { logger } from './logger.js';

let webhookUrl;
let lastSent = 0;

export function initErrorReporting(url) {
  webhookUrl = url;
}

/** Logs an error and (optionally) forwards a short summary to the operator's webhook. */
export function reportError(err, context = {}) {
  logger.error({ err, ...context }, context.msg ?? 'unhandled error');
  if (!webhookUrl) return;
  const now = Date.now();
  if (now - lastSent < 10_000) return; // at most one alert per 10 s
  lastSent = now;
  const summary = `**Sum error**${context.where ? ` in \`${context.where}\`` : ''}\n\`\`\`\n${String(
    err?.stack ?? err,
  ).slice(0, 1700)}\n\`\`\``;
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: summary, allowed_mentions: { parse: [] } }),
  }).catch(() => {});
}

/** Discord error codes that mean "Sum lacks permission/access here". */
export function isPermissionError(err) {
  return err?.code === 50013 || err?.code === 50001;
}
