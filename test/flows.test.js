import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, MessageFlags, PermissionsBitField } from 'discord.js';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { KeyedQueue } from '../src/game/queue.js';
import { onMessageCreate, onMessageDelete, onMessageUpdate } from '../src/game/handler.js';
import { onInteraction } from '../src/interactions/router.js';
import { BRAND } from '../src/config.js';
import { reactionId } from '../src/ui/emoji.js';

const OK = reactionId('checkmark');
const NO = reactionId('crossmark');

/** Minimal fakes of the discord.js objects Sum touches. */
function harness() {
  const store = new Store(openDatabase(':memory:'));
  const sent = [];
  const removedRoles = [];
  const allPerms = { has: () => true };
  const countChannel = {
    id: 'count',
    type: ChannelType.GuildText,
    name: 'sum',
    isTextBased: () => true,
    permissionsFor: () => allPerms,
    send: async (p) => (sent.push(p), { id: `bot${sent.length}` }),
  };
  const guild = {
    id: 'g',
    name: 'Test',
    ownerId: 'owner',
    members: {
      me: null,
      fetch: async (userId) => ({
        roles: {
          cache: new Map([['ruined', {}]]),
          add: async () => {},
          remove: async (roleId) => removedRoles.push([userId, roleId]),
        },
      }),
    },
    channels: { cache: new Map([['count', countChannel]]) },
    roles: { cache: new Map() },
    fetchOwner: async () => ({ send: async () => {} }),
  };
  const client = {
    guilds: { cache: new Map([['g', guild]]) },
    channels: { cache: new Map([['count', countChannel]]) },
  };
  const app = { client, store, queue: new KeyedQueue(), config: { applicationId: '123' } };
  store.ensureGuild('g');
  store.updateGuild('g', { count_channel_id: 'count' });

  let n = 0;
  const say = async (userId, content) => {
    const reactions = [];
    const message = {
      id: `m${++n}`,
      guildId: 'g',
      channelId: 'count',
      content,
      url: 'https://discord.com/channels/g/count/x',
      author: { id: userId, bot: false },
      guild,
      channel: countChannel,
      react: async (e) => reactions.push(e),
      delete: async () => reactions.push('deleted'),
    };
    await onMessageCreate(app, message);
    return { message, reactions };
  };

  const interact = async (customId, { userId = 'owner', values = [], users, perms = 0n } = {}) => {
    let payload;
    const interaction = {
      customId,
      guildId: 'g',
      guild,
      user: { id: userId },
      member: { roles: [] },
      memberPermissions: new PermissionsBitField(perms),
      values,
      users,
      replied: false,
      deferred: false,
      inGuild: () => true,
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
      isRepliable: () => true,
      update: async (p) => (payload = p),
      reply: async (p) => (payload = p),
      deferUpdate: async () => {},
      editReply: async (p) => (payload = p),
    };
    await onInteraction(app, interaction);
    return payload;
  };

  const command = async (commandName, userId = 'owner') => {
    let payload;
    await onInteraction(app, {
      commandName,
      guildId: 'g',
      guild,
      user: { id: userId },
      member: { roles: [] },
      memberPermissions: new PermissionsBitField(0n),
      inGuild: () => true,
      isChatInputCommand: () => true,
      isMessageComponent: () => false,
      isRepliable: () => true,
      reply: async (p) => (payload = p),
    });
    return payload;
  };

  return { app, store, sent, removedRoles, say, interact, command, g: () => store.getGuild('g') };
}

test('a counting session end to end', async () => {
  const h = harness();
  assert.deepEqual((await h.say('a', '1')).reactions, [OK]);
  assert.deepEqual((await h.say('b', '1+1')).reactions, [OK]);
  assert.deepEqual((await h.say('b', 'hello there')).reactions, []); // chatter ignored
  assert.deepEqual((await h.say('b', '3')).reactions, ['🛟']); // double → save
  assert.equal(h.g().current_count, 2);
  assert.deepEqual((await h.say('a', '7')).reactions, [NO]); // wrong → ruin
  assert.equal(h.g().current_count, 0);
  const lastCard = JSON.stringify(h.sent.at(-1).components);
  assert.ok(lastCard.includes('run over'));
  assert.equal(h.sent.at(-1).flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
});

test('concurrent identical counts: only one is accepted', async () => {
  const h = harness();
  await h.say('a', '1');
  h.store.updateGuild('g', { saves_enabled: 0 });
  const [x, y] = await Promise.all([h.say('b', '2'), h.say('c', '2')]);
  assert.deepEqual(x.reactions, [OK]);
  assert.deepEqual(y.reactions, [NO]);
});

test('strict mode deletes chatter', async () => {
  const h = harness();
  h.store.updateGuild('g', { strict_mode: 1 });
  assert.deepEqual((await h.say('a', 'hi')).reactions, ['deleted']);
});

test('deleting the latest count reposts it and benches the player', async () => {
  const h = harness();
  await h.say('a', '1');
  const { message } = await h.say('b', '2');
  await onMessageDelete(h.app, { id: message.id, guildId: 'g', channelId: 'count' });
  assert.ok(JSON.stringify(h.sent.at(-1).components).includes('vanished'));
  assert.deepEqual((await h.say('b', '3')).reactions, ['deleted']); // benched → removed
  assert.deepEqual((await h.say('a', '3')).reactions, [OK]);
});

test('cosmetic edits are fine, number changes are tampering', async () => {
  const h = harness();
  const { message } = await h.say('a', '1');
  await onMessageUpdate(h.app, null, { ...message, content: '1 woo' });
  assert.equal(h.sent.length, 0);
  await onMessageUpdate(h.app, null, { ...message, content: '5' });
  assert.ok(JSON.stringify(h.sent.at(-1).components).includes('edited'));
});

test('/sum: owner gets the setup wizard when unconfigured, members get overview', async () => {
  const h = harness();
  h.store.updateGuild('g', { count_channel_id: null });
  const owner = await h.command('sum', 'owner');
  assert.ok(JSON.stringify(owner.components).includes('set up Sum'));
  assert.equal(owner.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  const member = await h.command('sum', 'someone');
  assert.ok(JSON.stringify(member.components).includes('Ask a server admin'));
  assert.ok(!JSON.stringify(member.components).includes('sum:nav:settings'));
});

test('/about shows version, brand colour and links', async () => {
  const h = harness();
  const about = await h.command('about');
  const json = JSON.stringify(about.components);
  assert.ok(json.includes(`v${BRAND.version}`));
  assert.ok(json.includes('discord.gg/dRxSt8Bt9t'));
  assert.ok(json.includes('davevancauwenberghe.be'));
  assert.equal(about.components[0].toJSON().accent_color, 0xff4500);
});

test('settings are admin-only; admin roles grant access', async () => {
  const h = harness();
  const denied = await h.interact('sum:toggle:strict_mode:rules', { userId: 'rando' });
  assert.ok(JSON.stringify(denied.components).includes('Admins only'));
  assert.equal(h.g().strict_mode, 0);

  await h.interact('sum:set:admins', { values: ['modrole'] });
  assert.deepEqual(h.g().admin_role_ids, ['modrole']);

  const manageGuild = await h.interact('sum:toggle:strict_mode:rules', {
    userId: 'mod',
    perms: PermissionsBitField.Flags.ManageGuild,
  });
  assert.ok(JSON.stringify(manageGuild.components).includes('Strict channel'));
  assert.equal(h.g().strict_mode, 1);
});

test('panel navigation, leaderboard and player lookup', async () => {
  const h = harness();
  await h.say('a', '1');
  await h.say('b', '2');
  for (const id of ['sum:nav:overview', 'sum:nav:leaderboard', 'sum:nav:player', 'sum:nav:help', 'sum:nav:settings']) {
    const p = await h.interact(id);
    assert.ok(p?.components?.length, id);
  }
  const lb = await h.interact('sum:lb:category', { values: ['streak'] });
  assert.ok(JSON.stringify(lb.components).includes('Best streak'));
  const player = await h.interact('sum:player:pick', { users: new Collection([['b', { id: 'b', bot: false }]]) });
  const json = JSON.stringify(player.components);
  assert.ok(json.includes('Player stats') && json.includes('<@b>'));
});

test('danger zone: reset and wipe', async () => {
  const h = harness();
  await h.say('a', '1');
  await h.say('b', '2');
  const confirm = await h.interact('sum:danger:reset');
  assert.ok(JSON.stringify(confirm.components).includes('Really reset'));
  await h.interact('sum:danger:reset:yes');
  assert.equal(h.g().current_count, 0);
  assert.equal(h.g().high_score, 2);
  h.store.addTempRole('g', 'a', 'ruined', Date.now() + 60_000);
  const wiped = await h.interact('sum:danger:wipe:yes');
  assert.ok(JSON.stringify(wiped.components).includes('set up Sum'));
  assert.deepEqual(h.removedRoles, [['a', 'ruined']]); // active ruined role taken back first
  assert.equal(h.store.tempRolesForGuild('g').length, 0);
  assert.equal(h.g().high_score, 0);
  assert.equal(h.g().count_channel_id, null);
});
