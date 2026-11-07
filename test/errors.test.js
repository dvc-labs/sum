import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAPIError } from 'discord.js';
import { initErrorReporting, reportError } from '../src/services/errors.js';
import { logger } from '../src/services/logger.js';

test('Discord errors expose safe diagnostics in the logger and webhook', (t) => {
  const logs = [];
  const webhooks = [];
  t.mock.method(logger, 'error', (details) => { logs.push(details); });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { webhooks.push(options.body); });
  initErrorReporting('https://example.invalid');

  const error = new DiscordAPIError(
    { message: 'raw-error-marker', code: 50035 }, 50035, 400, 'POST',
    'https://discord.com/api/v10/interactions/123/token-marker/callback',
    { body: { data: { content: 'raw-payload-marker' } } },
  );
  reportError(error, { where: 'Discord interaction', guildId: '123' });

  assert.equal(logs[0].error.code, 50035);
  assert.equal(logs[0].error.status, 400);
  assert.match(webhooks[0], /50035/);
  assert.doesNotMatch(JSON.stringify({ logs, webhooks }), /raw-error-marker|token-marker|raw-payload-marker/);
});
