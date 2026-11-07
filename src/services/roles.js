import { writeIfLeader } from './leader.js';
import { errorDetails, logger } from './logger.js';
import { ruinedRoleIssue } from './permissions.js';

const RETRY_MS = 5 * 60_000;
// A missing member or role cannot still have this grant. Lost access and
// permission errors can be fixed by an admin and remain eligible for cleanup.
const GONE = new Set([10007, 10011, 10013]);

function currentConfig(store, expected) {
  const row = store.getGuild(expected.guild_id);
  if (row && !row.left_at && row.created_at === expected.created_at &&
      row.ruined_role_enabled && row.ruined_role_id === expected.ruined_role_id) return row;
}

/** Gives the ruined role to a player without adopting an existing manual grant. */
export async function assignRuinedRole(app, expected, userId) {
  const { client, store } = app;
  if (app.leader && !app.leader.isLeader()) return;
  const guild = client.guilds.cache.get(expected.guild_id);
  const initial = currentConfig(store, expected);
  if (!guild || guild.available === false || !initial || ruinedRoleIssue(guild, initial)) return;

  let pending;
  try {
    const member = await guild.members.fetch({ user: userId, force: true, cache: false });
    pending = writeIfLeader(app, () => {
      const row = currentConfig(store, expected);
      if (!row || ruinedRoleIssue(guild, row)) return;

      const roleId = row.ruined_role_id;
      const now = Date.now();
      const tracked = store.getTempRole(guild.id, userId, roleId);
      if (tracked?.retry_at > now) return; // another grant or removal may be in flight

      const alreadyHasRole = member.roles.cache.has(roleId);
      if (alreadyHasRole && !tracked) return;
      const expiry = now + row.ruined_role_minutes * 60_000;
      const retryAt = alreadyHasRole ? 0 : now + RETRY_MS;
      // Record the grant before calling Discord so a crash cannot lose its cleanup.
      store.addTempRole(guild.id, userId, roleId, expiry, retryAt);
      if (!alreadyHasRole) return store.getTempRole(guild.id, userId, roleId);
    });
    if (pending) await member.roles.add(pending.role_id, 'Sum: ruined the count');
  } catch (err) {
    // A definitive refusal means Sum never obtained the role. Keep the
    // record after ambiguous failures, in case Discord applied the grant.
    if (pending && [400, 403, 404].includes(err?.status)) {
      writeIfLeader(app, () => store.removeTempRole(pending));
    }
    logger.warn({ guildId: guild.id, error: errorDetails(err) }, 'ruined role assign failed');
  } finally {
    if (pending) writeIfLeader(app, () => store.retryTempRole(pending, 0));
  }
}

async function expireRole(app, entry) {
  const { store, client, leader } = app;
  const reserved = writeIfLeader(app, () => {
    const current = store.getTempRole(entry.guild_id, entry.user_id, entry.role_id);
    const now = Date.now();
    if (!current || current.expires_at > now || current.retry_at > now) return;
    const retryAt = now + RETRY_MS;
    store.retryTempRole(current, retryAt);
    return { ...current, retry_at: retryAt };
  });
  if (!reserved) return;

  const guild = client.guilds.cache.get(entry.guild_id);
  if (!guild || guild.available === false) return; // try again when the guild is reachable
  try {
    const member = await guild.members.fetch({ user: entry.user_id, force: true, cache: false });
    if (leader && !leader.isLeader()) return;
    if (member.roles.cache.has(entry.role_id)) {
      await member.roles.remove(entry.role_id, 'Sum: ruined role expired');
    }
  } catch (err) {
    if (!GONE.has(err?.code)) {
      logger.warn({ guildId: guild.id, error: errorDetails(err) }, 'ruined role removal failed — will retry');
      return;
    }
  }
  writeIfLeader(app, () => store.removeTempRole(reserved));
}

/** Serializes grants, expiry and wipe cleanup for each guild. */
export async function sweepTempRoles(app, guildId) {
  const entries = guildId ? app.store.tempRolesForGuild(guildId) : app.store.dueTempRoles();
  for (const entry of entries) {
    if (app.leader && !app.leader.isLeader()) return;
    await app.roleQueue.run(entry.guild_id, () => expireRole(app, entry));
  }
}
