import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { KeyedQueue } from '../src/game/queue.js';
import { onMessageCreate, onMessageDelete, onMessageDeleteBulk, onMessageUpdate } from '../src/game/handler.js';
import { onInteraction } from '../src/interactions/router.js';
import { BRAND } from '../src/config.js';
import { reactionId } from '../src/ui/emoji.js';

const OK = reactionId('checkmark');
const NO = reactionId('crossmark');

/** Minimal fakes of the discord.js objects Sum touches. */
function harness({ addRole = async () => {} } = {}) {
  const store = new Store(openDatabase(':memory:'));
  const sent = [];
  const removedRoles = [];
  const grants = new Map();
  const memberPerms = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory;
  const botPerms = new PermissionsBitField(memberPerms | PermissionFlagsBits.AddReactions |
    PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageRoles);
  const me = { permissions: botPerms, roles: { highest: { comparePositionTo: (role) => 10 - role.position } } };
  const makeChannel = (id) => ({
    id,
    type: ChannelType.GuildText,
    name: 'sum',
    isTextBased: () => true,
    permissionsFor: (member) => member === me ? me.permissions : member?.channelPerms.get(id),
    permissionOverwrites: { cache: new Map() },
    send: async (p) => (sent.push(p), { id: `bot${sent.length}` }),
  });
  const countChannel = makeChannel('count');
  const otherChannel = makeChannel('other');
  const logChannel = makeChannel('log');
  const roles = new Map([
    ['ruined', { id: 'ruined', position: 1, permissions: new PermissionsBitField(0n) }],
    ['modrole', { id: 'modrole', position: 2, permissions: new PermissionsBitField(0n) }],
    ['staff', { id: 'staff', position: 3, permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }],
  ]);
  const guild = {
    id: 'g',
    name: 'Test',
    ownerId: 'owner',
    members: {
      me,
      fetch: async ({ user: userId, force, cache }) => ({
        roles: {
          cache: grants.get(userId) ?? new Map(),
          add: async (roleId) => {
            assert.equal(force, true);
            assert.equal(cache, false);
            await addRole();
            if (!grants.has(userId)) grants.set(userId, new Map());
            grants.get(userId).set(roleId, roles.get(roleId));
          },
          remove: async (roleId) => {
            grants.get(userId).delete(roleId);
            removedRoles.push([userId, roleId]);
          },
        },
      }),
    },
    channels: { cache: new Map([['count', countChannel], ['other', otherChannel], ['log', logChannel]]) },
    roles: { cache: roles },
    fetchOwner: async () => ({ send: async () => {} }),
  };
  const client = {
    guilds: { cache: new Map([['g', guild]]) },
    channels: { cache: new Map([['count', countChannel]]) },
  };
  const app = {
    client, store, queue: new KeyedQueue(), effects: new KeyedQueue(), roleQueue: new KeyedQueue(),
    config: { applicationId: '123' },
  };
  store.ensureGuild('g');
  store.updateGuild('g', { count_channel_id: 'count' });

  let n = 0;
  const say = async (userId, content, { react, beforeDispatch } = {}) => {
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
      react: react ?? (async (e) => reactions.push(e)),
      delete: async () => reactions.push('deleted'),
    };
    beforeDispatch?.(message);
    await onMessageCreate(app, message);
    return { message, reactions };
  };

  const member = (roleIds, perms, channels) => ({
    roles: { cache: new Map(roleIds.map((id) => [id, roles.get(id)])), highest: { comparePositionTo: () => 1 } },
    permissions: new PermissionsBitField(perms),
    channelPerms: new Map(Object.keys(channels).map((id) => [id, new PermissionsBitField(channels[id])])),
  });
  const channelDefaults = { count: memberPerms, other: memberPerms, log: memberPerms };
  const interact = async (customId, {
    userId = 'owner', values = [], users, perms = 0n, roleIds = [], channels = channelDefaults, onDeferred,
  } = {}) => {
    let payload;
    const interaction = {
      customId,
      guildId: 'g',
      guild,
      user: { id: userId },
      member: member(roleIds, perms, channels),
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
      deferUpdate: async () => {
        interaction.deferred = true;
        onDeferred?.();
      },
      editReply: async (p) => (payload = p),
      followUp: async (p) => (payload = p),
    };
    await onInteraction(app, interaction);
    return payload;
  };

  const command = async (commandName, userId = 'owner', channels = channelDefaults) => {
    let payload;
    await onInteraction(app, {
      commandName,
      guildId: 'g',
      guild,
      user: { id: userId },
      member: member([], 0n, channels),
      memberPermissions: new PermissionsBitField(0n),
      inGuild: () => true,
      isChatInputCommand: () => true,
      isMessageComponent: () => false,
      isRepliable: () => true,
      reply: async (p) => (payload = p),
    });
    return payload;
  };

  return {
    app, store, sent, removedRoles, grants, guild, countChannel, roles, say, interact, command,
    g: () => store.getGuild('g'),
  };
}

test('a counting session end to end', async () => {
  const h = harness();
  assert.deepEqual((await h.say('a', '1️⃣')).reactions, [OK]);
  assert.deepEqual((await h.say('b', '1,5+0,5')).reactions, [OK]);
  assert.deepEqual((await h.say('b', 'hello there')).reactions, []); // chatter ignored
  assert.deepEqual((await h.say('b', '3')).reactions, ['🛟']); // double → save
  assert.equal(h.g().current_count, 2);
  assert.deepEqual((await h.say('a', '7')).reactions, [NO]); // wrong → ruin
  assert.equal(h.g().current_count, 0);
  const lastCard = JSON.stringify(h.sent.at(-1).components);
  assert.ok(lastCard.includes('run over'));
  assert.match(lastCard, /<:trophy:1568787179357081680> High score/);
  assert.equal(h.sent.at(-1).flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
});

test('counts past the old record get the high-score tick and trophy announcements', async () => {
  const h = harness();
  h.store.updateGuild('g', { high_score: 2, record_to_beat: 2, log_channel_id: 'log' });
  await h.say('a', '1');
  await h.say('b', '2');
  assert.deepEqual((await h.say('a', '3')).reactions, ['highscore:1568783387685028001']);
  assert.deepEqual((await h.say('b', '4')).reactions, ['highscore:1568783387685028001']);
  assert.equal(h.sent.length, 2);
  assert.match(JSON.stringify(h.sent[0].components), /<:trophy:1568787179357081680> New high score!/);
  assert.match(JSON.stringify(h.sent[1].components), /<:trophy:1568787179357081680> New high score run/);
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

test('single deletes bench the latest counter and bulk deletes only repost the count', async () => {
  const h = harness();
  h.store.updateGuild('g', { log_channel_id: 'log' });
  const first = await h.say('a', '1');
  const { message } = await h.say('b', '2');
  await onMessageDelete(h.app, first.message);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.isDisqualified('g', 'a', h.g().run_id), false);

  await onMessageDelete(h.app, { id: message.id, guildId: 'g', channelId: 'count' });
  assert.equal(h.g().current_count, 2);
  assert.equal(h.store.isDisqualified('g', 'b', h.g().run_id), true);
  assert.match(JSON.stringify(h.sent[0].components), /vanished.*Next number is \*\*3\*\*.*<@b> is benched/);
  assert.match(JSON.stringify(h.sent[1].components), /Count deleted.*They are benched/);
  assert.deepEqual((await h.say('b', '3')).reactions, ['deleted']);

  const third = await h.say('a', '3');
  const chatter = await h.say('c', 'nice going');
  const purged = new Collection([third.message, chatter.message].map((message) => [message.id, message]));
  await onMessageDeleteBulk(h.app, purged, { guildId: 'g', id: 'count' });
  assert.equal(h.g().current_count, 3);
  assert.equal(h.g().last_message_id, null);
  assert.equal(h.store.isDisqualified('g', 'a', h.g().run_id), false);
  const correction = JSON.stringify(h.sent[2].components);
  const log = JSON.stringify(h.sent[3].components);
  assert.match(correction, /vanished.*Next number is \*\*4\*\*/);
  assert.match(log, /Count deleted/);
  assert.doesNotMatch(correction + log, /benched/);
  assert.deepEqual((await h.say('c', '4')).reactions, [OK]);
  assert.deepEqual((await h.say('a', '5')).reactions, [OK]);

  await h.interact('sum:danger:reset:yes');
  assert.deepEqual((await h.say('b', '1')).reactions, [OK]);
});

test('content edits bench the latest counter even when the number stays the same', async () => {
  const h = harness();
  const { message } = await h.say('a', '1');
  await onMessageUpdate(h.app, message, { ...message, pinned: true });
  await onMessageUpdate(h.app, { content: null }, { ...message, pinned: true, editedTimestamp: null });
  assert.equal(h.sent.length, 0);
  await onMessageUpdate(h.app, message, { ...message, content: '1 woo' });
  assert.match(JSON.stringify(h.sent.at(-1).components), /edited.*<@a> is benched/);
  assert.equal(h.store.isDisqualified('g', 'a', h.g().run_id), true);
  assert.deepEqual((await h.say('a', '2')).reactions, ['deleted']);

  const second = await h.say('b', '2');
  await onMessageUpdate(h.app, { content: null }, { ...second.message, content: '3', editedTimestamp: Date.now() });
  assert.equal(h.store.isDisqualified('g', 'b', h.g().run_id), true);
});

test('with benching off, edits and deletes still repost the latest count', async () => {
  const h = harness();
  h.store.updateGuild('g', { rule_edit_delete: 0 });
  const first = await h.say('a', '1');
  await onMessageUpdate(h.app, first.message, { ...first.message, content: '99' });
  assert.match(JSON.stringify(h.sent.at(-1).components), /edited/);
  assert.equal(h.store.isDisqualified('g', 'a', h.g().run_id), false);

  const second = await h.say('b', '2');
  await onMessageDelete(h.app, second.message);
  assert.match(JSON.stringify(h.sent.at(-1).components), /vanished/);
  assert.equal(h.store.isDisqualified('g', 'b', h.g().run_id), false);
  assert.deepEqual((await h.say('a', '3')).reactions, [OK]);
});

test('/sum guides admins from channel selection through reviewing rules', async () => {
  const h = harness();
  h.store.updateGuild('g', { count_channel_id: null });
  const reviewId = 'sum:settings:setup-rules';
  const reviewButton = (payload) => {
    const panels = payload.components.map((component) => component.toJSON());
    return panels.flatMap((panel) => panel.components ?? [])
      .flatMap((component) => component.components ?? [])
      .find((button) => button.custom_id === reviewId);
  };
  const owner = await h.command('sum', 'owner');
  assert.match(JSON.stringify(owner.components), /Step 1 of 2/);
  assert.equal(owner.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  assert.equal(reviewButton(owner).disabled, true);
  const member = await h.command('sum', 'someone');
  assert.ok(JSON.stringify(member.components).includes('Ask a server admin'));
  assert.ok(!JSON.stringify(member.components).includes('sum:nav:settings'));
  const denied = await h.interact(reviewId, { userId: 'someone' });
  assert.match(JSON.stringify(denied.components), /Admins only/);
  const tooSoon = await h.interact(reviewId);
  assert.equal(reviewButton(tooSoon).disabled, true);

  const selected = await h.interact('sum:set:count:setup-channels', { values: ['count'] });
  assert.equal(h.g().count_channel_id, 'count');
  assert.equal(reviewButton(selected).disabled, false);
  assert.match(JSON.stringify(h.sent[0].components), /Sum is live in this channel/);
  const withLog = await h.interact('sum:set:log:setup-channels', { values: ['log'] });
  assert.equal(h.g().log_channel_id, 'log');
  assert.equal(reviewButton(withLog).disabled, false);
  const withAdmins = await h.interact('sum:set:admins:setup-channels', { values: ['modrole'] });
  assert.deepEqual(h.g().admin_role_ids, ['modrole']);
  assert.equal(reviewButton(withAdmins).disabled, false);

  const rules = await h.interact(reviewId);
  assert.match(JSON.stringify(rules.components), /Step 2 of 2.*Settings → Ruined role.*Open overview/);
  const toggled = await h.interact('sum:toggle:math_enabled:setup-rules');
  assert.equal(h.g().math_enabled, 0);
  assert.match(JSON.stringify(toggled.components), /Step 2 of 2.*Open overview/);
  const back = await h.interact('sum:settings:setup-channels');
  assert.equal(reviewButton(back).disabled, false);
  const reviewedAgain = await h.interact(reviewId);
  assert.match(JSON.stringify(reviewedAgain.components), /Step 2 of 2.*Start with a single number/);
  const finished = await h.interact('sum:nav:overview');
  assert.match(JSON.stringify(finished.components), /Next up: \*\*1\*\* in <#count>/);
  assert.doesNotMatch(JSON.stringify(finished.components), /Step [12] of 2/);
});

test('/about shows version, brand colour and links', async () => {
  const h = harness();
  const about = await h.command('about');
  const json = JSON.stringify(about.components);
  assert.ok(json.includes(`v${BRAND.version}`));
  assert.ok(json.includes('discord.gg/dRxSt8Bt9t'));
  assert.ok(json.includes('davevancauwenberghe.be'));
  assert.ok(json.includes('permissions=268512320'));
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
    channels: { count: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageMessages },
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
  h.store.updateGuild('g', { math_enabled: 0 });
  const help = await h.interact('sum:nav:help');
  const helpText = JSON.stringify(help.components);
  assert.match(helpText, /Math mode is off.*2,00/);
  assert.match(helpText, /number emoji/);
  assert.doesNotMatch(helpText, /1,5\+0,5/);
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
  h.grants.set('a', new Map([['ruined', h.roles.get('ruined')]]));
  const wiped = await h.interact('sum:danger:wipe:yes');
  assert.ok(JSON.stringify(wiped.components).includes('set up Sum'));
  assert.deepEqual(h.removedRoles, [['a', 'ruined']]); // active ruined role taken back first
  assert.equal(h.store.tempRolesForGuild('g').length, 0);
  assert.equal(h.g().high_score, 0);
  assert.equal(h.g().count_channel_id, null);
});

test('delegated admins cannot turn Sum into a Discord moderation proxy', async () => {
  const h = harness();
  const delegate = { userId: 'delegate', roleIds: ['modrole'] };
  h.store.updateGuild('g', { admin_role_ids: ['modrole'] });

  const strict = await h.interact('sum:toggle:strict_mode:rules', delegate);
  assert.match(JSON.stringify(strict.components), /Manage Messages/);
  assert.equal(h.g().strict_mode, 0);
  await h.interact('sum:set:count', { ...delegate, values: ['other'] });
  assert.equal(h.g().count_channel_id, 'count'); // Sum can delete benched attempts
  await h.interact('sum:set:ruinedrole', { ...delegate, values: ['ruined'] });
  assert.equal(h.g().ruined_role_id, null);

  await h.interact('sum:set:ruinedrole', { values: ['staff'] });
  assert.equal(h.g().ruined_role_id, null);
  h.countChannel.permissionOverwrites.cache.set('ruined', {
    allow: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
  });
  await h.interact('sum:set:ruinedrole', { values: ['ruined'] });
  assert.equal(h.g().ruined_role_id, null);
  h.countChannel.permissionOverwrites.cache.clear();
  await h.interact('sum:set:ruinedrole', { values: ['ruined'] });
  assert.equal(h.g().ruined_role_id, 'ruined');
  await h.interact('sum:toggle:ruined_role_enabled:role', delegate);
  assert.equal(h.g().ruined_role_enabled, 0);
  await h.interact('sum:toggle:ruined_role_enabled:role');
  assert.equal(h.g().ruined_role_enabled, 1);

  h.roles.get('ruined').permissions.add(PermissionFlagsBits.ManageChannels);
  h.store.updateGuild('g', { saves: 0 });
  await h.say('a', '1');
  await h.say('b', '99');
  assert.equal(h.grants.has('b'), false); // rechecks permission drift when granting
});

test('private channel activity is gated on every read path and cannot be exposed by moving the game', async () => {
  const h = harness();
  await h.say('player', '1');
  const overview = await h.command('sum', 'guest', {});
  assert.match(JSON.stringify(overview.components), /need access to the counting channel/);
  for (const id of ['sum:nav:leaderboard', 'sum:lb:page:counts:0', 'sum:nav:player', 'sum:player:pick']) {
    const payload = await h.interact(id, { userId: 'guest', channels: {} });
    const content = JSON.stringify(payload.components);
    assert.match(content, /need access to the counting channel/);
    assert.doesNotMatch(content, /<@player>/);
  }
  h.store.updateGuild('g', { admin_role_ids: ['modrole'] });
  await h.interact('sum:set:count', {
    userId: 'guest', roleIds: ['modrole'], values: ['other'],
    channels: { other: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageMessages },
  });
  assert.equal(h.g().count_channel_id, 'count');
});

test('members without message history can read generic help, but cannot read stats or reset or wipe', async () => {
  const h = harness();
  await h.say('player', '1');
  h.store.updateGuild('g', { admin_role_ids: ['modrole'] });
  const channels = { count: PermissionFlagsBits.ViewChannel };
  const delegate = { userId: 'delegate', roleIds: ['modrole'], channels };
  const overview = await h.command('sum', 'delegate', channels);
  assert.match(JSON.stringify(overview.components), /Read Message History/);
  const help = await h.interact('sum:nav:help', delegate);
  const helpText = JSON.stringify(help.components);
  assert.match(helpText, /How to play/);
  assert.doesNotMatch(helpText, /<#count>|<@player>/);
  for (const action of ['reset', 'wipe']) {
    const denied = await h.interact(`sum:danger:${action}:yes`, delegate);
    assert.match(JSON.stringify(denied.components), /Read Message History/);
    assert.equal(h.g().current_count, 1);
    assert.equal(h.g().count_channel_id, 'count');
  }
});

test('slow Discord effects leave counts and the reset acknowledgement responsive', async () => {
  const h = harness();
  const reaction = Promise.withResolvers();
  const first = h.say('a', '1', { react: () => reaction.promise });
  const second = h.say('b', '2');
  await h.app.queue.drain();
  assert.equal(h.g().current_count, 2);

  const stateGate = Promise.withResolvers();
  const blocker = h.app.queue.run('g', () => stateGate.promise);
  let acknowledged = false;
  const reset = h.interact('sum:danger:reset:yes', { onDeferred: () => { acknowledged = true; } });
  await new Promise(setImmediate);
  assert.equal(acknowledged, true);
  assert.equal(h.g().current_count, 2);
  stateGate.resolve();
  await blocker;
  await h.app.queue.drain();
  assert.equal(h.g().current_count, 0);
  reaction.resolve();
  await Promise.all([first, second, reset]);
});

test('a queued deletion benches the author before processing another count', async () => {
  const h = harness();
  const stateGate = Promise.withResolvers();
  h.app.queue.run('g', () => stateGate.promise);
  let message;
  const count = h.say('a', '1', { beforeDispatch: (value) => { message = value; } });
  const deletion = onMessageDelete(h.app, message);
  const next = h.say('a', '2');
  stateGate.resolve();
  const [, , attempt] = await Promise.all([count, deletion, next]);
  assert.equal(h.g().current_count, 1);
  assert.equal(h.g().last_message_id, null);
  assert.deepEqual(attempt.reactions, ['deleted']);
  assert.match(JSON.stringify(h.sent.at(-1).components), /vanished/);
});

test('save and ruin reactions, cards and logs survive a saturated effects queue', async () => {
  const h = harness();
  h.app.effects = new KeyedQueue({ maxPerKey: 1 });
  h.store.updateGuild('g', { log_channel_id: 'log' });
  const slow = Promise.withResolvers();
  const correct = h.say('a', '1', { react: () => slow.promise });
  const save = h.say('b', '99');
  const ruin = h.say('b', '98');
  await h.app.queue.drain();
  assert.equal(h.g().current_count, 0);
  assert.equal(h.g().saves, 0);
  slow.resolve();
  const [, saved, ruined] = await Promise.all([correct, save, ruin]);
  assert.deepEqual(saved.reactions, ['🛟']);
  assert.deepEqual(ruined.reactions, [NO]);
  const notices = JSON.stringify(h.sent.map((payload) => payload.components));
  assert.match(notices, /Save used!/);
  assert.match(notices, /Save used\*\*/);
  assert.match(notices, /run over!/);
  assert.match(notices, /Run ruined/);
});

test('replayed successful and wrong attempts have no second effect', async () => {
  const h = harness();
  const first = await h.say('a', '1');
  await onMessageCreate(h.app, first.message);
  assert.equal(h.g().saves, 1);
  const mistake = await h.say('b', '999');
  await onMessageCreate(h.app, mistake.message);
  assert.equal(h.g().current_count, 1);
  assert.equal(h.g().saves, 0);
  assert.equal(h.store.getStats('g', 'b').mistakes, 1);
});

test('invalid count text never reaches announcement or log cards', async () => {
  const h = harness();
  h.store.updateGuild('g', { log_channel_id: 'log' });
  await h.say('a', '1');
  const malformed = '1/0 ` [review](https://example.invalid)';
  await h.say('b', malformed);
  await h.say('b', malformed);
  assert.equal(h.sent.length, 4);
  for (const payload of h.sent) {
    const rendered = JSON.stringify(payload.components);
    assert.match(rendered, /entered an invalid count/);
    assert.doesNotMatch(rendered, /example\.invalid/);
  }
});

test('fractional results explain the whole-number rule in announcements and logs', async () => {
  const h = harness();
  h.store.updateGuild('g', { log_channel_id: 'log' });
  await h.say('a', '1');
  assert.deepEqual((await h.say('b', '1/3')).reactions, ['🛟']);
  assert.deepEqual((await h.say('b', '1,5')).reactions, [NO]);
  assert.equal(h.sent.length, 4);
  for (const payload of h.sent) {
    assert.match(JSON.stringify(payload.components), /got a fractional result\. Counts must be whole numbers/);
  }
});

test('a wipe retains tracking for a grant already in flight and revokes it when it completes', async () => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const h = harness({ addRole: async () => { started.resolve(); await release.promise; } });
  h.store.updateGuild('g', { ruined_role_id: 'ruined', ruined_role_enabled: 1, saves: 0 });
  await h.say('a', '1');

  const ruin = h.say('b', '999');
  await started.promise;
  const wipe = h.interact('sum:danger:wipe:yes');
  await new Promise(setImmediate);
  assert.equal(h.g().count_channel_id, null);
  assert.ok(h.store.getTempRole('g', 'b', 'ruined'));

  release.resolve();
  await Promise.all([ruin, wipe]);
  assert.equal(h.store.tempRolesForGuild('g').length, 0);
  assert.equal(h.grants.get('b').has('ruined'), false);
});

test('manual role grants are left alone and expired Sum grants use fresh membership', async () => {
  const h = harness();
  h.store.updateGuild('g', { ruined_role_id: 'ruined', ruined_role_enabled: 1, saves: 0 });
  h.grants.set('a', new Map([['ruined', h.roles.get('ruined')]]));
  await h.say('b', '1');
  await h.say('a', '99');
  assert.equal(h.store.getTempRole('g', 'a', 'ruined'), undefined);
  await h.say('a', '1');
  await h.say('b', '99');
  assert.ok(h.store.getTempRole('g', 'b', 'ruined'));

  await h.interact('sum:danger:wipe:yes');
  assert.equal(h.grants.get('a').has('ruined'), true);
  assert.equal(h.grants.get('b').has('ruined'), false);
});
