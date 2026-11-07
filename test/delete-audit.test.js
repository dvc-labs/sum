import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent, Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { DeleteAudit } from '../src/services/delete-audit.js';

const candidate = { authorId: 'player', channelId: 'count', messageCreatedAt: 1000 };
const entry = (id, count, createdTimestamp = 1200, channelId = 'count') => ({
  id, targetId: 'player', createdTimestamp, extra: { count, channel: { id: channelId } },
});
const page = (entries) => ({ entries: new Collection(entries.map((item) => [item.id, item])) });

function fixture(fetchAuditLogs) {
  return {
    id: 'guild',
    members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.ViewAuditLog) } },
    fetchAuditLogs,
  };
}

test('audit matches the author and channel and treats a new moderator entry as ambiguous', async () => {
  const audit = new DeleteAudit({ settleMs: 0 });
  let entries = [entry('old', 1, 900), entry('other-channel', 1, 1200, 'other')];
  const guild = fixture(async ({ type }) => {
    assert.equal(type, AuditLogEvent.MessageDelete);
    return page(entries);
  });
  assert.equal(await audit.likelySelfDelete(guild, candidate), true);
  entries = [entry('moderator-delete', 1), ...entries];
  assert.equal(await audit.likelySelfDelete(guild, candidate), false);
});

test('an older audit entry whose deletion count increased blocks a bench', async () => {
  const audit = new DeleteAudit({ settleMs: 0 });
  let count = 2;
  const guild = fixture(async () => page([entry('aggregate', count, 900)]));
  assert.equal(await audit.likelySelfDelete(guild, candidate), false); // no prior observation
  const newerCount = { ...candidate, messageCreatedAt: Date.now() + 1000 };
  assert.equal(await audit.likelySelfDelete(guild, newerCount), true); // observed aggregate unchanged
  count = 3;
  assert.equal(await audit.likelySelfDelete(guild, newerCount), false);
});

test('audit lookup failures, missing permissions and truncated history abstain', async () => {
  const audit = new DeleteAudit({ settleMs: 0 });
  const guild = fixture(async () => { throw new Error('unavailable'); });
  assert.equal(await audit.likelySelfDelete(guild, candidate), false);
  guild.members.me.permissions.remove(PermissionFlagsBits.ViewAuditLog);
  let calls = 0;
  guild.fetchAuditLogs = async () => {
    calls++;
    return page(Array.from({ length: 100 }, (_, i) => entry(`id-${calls}-${i}`, 1, 1200, 'other')));
  };
  assert.equal(await audit.likelySelfDelete(guild, candidate), false);
  assert.equal(calls, 0);
  guild.members.me.permissions.add(PermissionFlagsBits.ViewAuditLog);
  assert.equal(await audit.likelySelfDelete(guild, candidate), false);
  assert.equal(calls, 3);
});
