import { PermissionFlagsBits } from 'discord.js';
import { BRAND } from '../config.js';
import { ACCENT } from '../ui/kit.js';
import { logEvent } from './notify.js';
import { logger } from './logger.js';

/**
 * Sum's colour role.
 *
 * Discord won't let a bot edit its own integration role (it is the bot's highest
 * role, and you can only edit roles below your highest one). So Sum creates a
 * small companion role — no permissions, not hoisted, not mentionable — coloured
 * with the brand orange, and gives it to itself. It sits at the bottom of the
 * role list, below Sum's own role.
 *
 * Admins stay in control: the role can be switched off in Settings → Roles, and
 * it is never recoloured or recreated after an admin changes or deletes it.
 */
export const BRAND_ROLE_NAME = BRAND.roleName;

/**
 * Makes the server match the guild's `brand_role_enabled` setting.
 * Returns 'created' | 'assigned' | 'ok' | 'removed' | 'skipped' | 'failed'.
 * Never throws: this is cosmetic and must not break joining or counting.
 */
export async function syncBrandRole(client, store, guildId, { by } = {}) {
  const row = store.getGuild(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!row || !guild || guild.available === false) return 'skipped'; // unavailable guild: roles aren't reliable

  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    let existing = row.brand_role_id ? guild.roles.cache.get(row.brand_role_id) : null;

    if (row.brand_role_id && !existing && row.brand_role_enabled) {
      // We made this role but it's gone: an admin deleted it while Sum was offline (or the event
      // was missed). Deleting it means "off" — never quietly recreate it.
      store.updateGuild(guildId, { brand_role_id: null, brand_role_enabled: 0 });
      logger.info({ guildId, roleId: row.brand_role_id }, 'tracked brand colour role is gone — switched off');
      return 'removed';
    }

    if (!existing && !row.brand_role_id && row.brand_role_enabled) {
      // Re-invited after being removed: adopt the role Sum left behind instead of making a second one.
      existing =
        guild.roles.cache.find(
          (r) => r.name === BRAND_ROLE_NAME && !r.managed && r.colors?.primaryColor === BRAND.color && r.permissions.bitfield === 0n,
        ) ?? null;
      if (existing) store.updateGuild(guildId, { brand_role_id: existing.id });
    }

    if (!row.brand_role_enabled) return await removeRole(store, row, existing, by);

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'skipped';

    if (existing) {
      // Already there. Make sure Sum wears it, but never touch an admin's customisations.
      if (me.roles.cache.has(existing.id)) return 'ok';
      if (existing.position >= me.roles.highest.position) return 'skipped';
      await me.roles.add(existing, 'Sum: brand colour role');
      return 'assigned';
    }

    const role = await guild.roles.create({
      name: BRAND_ROLE_NAME,
      colors: { primaryColor: BRAND.color },
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: by ? `Sum: brand colour role (turned on by ${by})` : 'Sum: brand colour role',
    });
    store.updateGuild(guildId, { brand_role_id: role.id });
    try {
      await me.roles.add(role, 'Sum: brand colour role');
    } catch (err) {
      // Keep the role tracked even if assigning failed; the next sync retries the assignment.
      logger.info({ guildId, err: err.message }, 'brand role created but could not be assigned');
      return 'created';
    }
    return 'created';
  } catch (err) {
    logger.info({ guildId, code: err?.code, err: err?.message }, 'brand colour role sync failed');
    return 'failed';
  }
}

async function removeRole(store, row, role, by) {
  if (!row.brand_role_id) return 'ok';
  if (role) {
    try {
      await role.delete(by ? `Sum: brand colour role turned off by ${by}` : 'Sum: brand colour role turned off');
    } catch (err) {
      if (err?.code !== 10011) throw err; // already gone is fine; anything else keeps the id so we can report/retry
    }
  }
  store.updateGuild(row.guild_id, { brand_role_id: null });
  return 'removed';
}

/** Startup pass: servers that never got the role (e.g. installed before v0.1.1) get it once. */
export async function reconcileBrandRoles(client, store) {
  for (const guild of client.guilds.cache.values()) {
    const row = store.getGuild(guild.id);
    if (!row || row.left_at) continue;
    if (!row.brand_role_enabled && !row.brand_role_id) continue; // off and nothing left to clean up
    // (a switched-off row that still tracks a role means an earlier delete failed: retry it)
    const result = await syncBrandRole(client, store, guild.id);
    if (result === 'created') {
      await logEvent(client, store.getGuild(guild.id), '🎨 Sum added its colour role', [
        `A role called **${BRAND_ROLE_NAME}** (no permissions) gives Sum its orange name colour.`,
        'Prefer not to have it? Turn it off in `/sum` → ⚙️ Settings → 🎭 Roles.',
      ], ACCENT.brand);
    }
  }
}
