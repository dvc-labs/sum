import {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { BRAND, GAME } from '../config.js';
import {
  ACCENT,
  button,
  channel,
  container,
  fmt,
  row,
  sectionWithButton,
  separator,
  text,
  ts,
  user,
} from './kit.js';
import { btn, e } from './emoji.js';
/**
 * The /sum panel. Every view is a pure function of a context object:
 * { store, guild, guildName, userId, isAdmin, issues: string[] }
 * Each returns an array of top-level V2 components.
 *
 * custom_id scheme: sum:<area>:<action>[:<arg>...]
 */

export const VIEWS = ['overview', 'leaderboard', 'player', 'help', 'settings'];

const RULES = [
  {
    key: 'rule_wrong_number',
    title: 'Wrong number ends the run',
    off: 'Off: wrong numbers are rejected, but the run keeps going.',
    on: 'On: a wrong number resets the count to 0 (unless a save kicks in).',
  },
  {
    key: 'rule_double_count',
    title: 'No counting twice in a row',
    off: 'Off: the same person may count back-to-back.',
    on: 'On: counting twice in a row is a mistake.',
  },
  {
    key: 'rule_edit_delete',
    title: 'Bench after edits or deletes',
    off: 'Off · Sum reposts the count and play continues.',
    on: 'On · A text edit or single deletion of the latest count benches its author until the next reset. Bulk deletes only repost the count.',
  },
  {
    key: 'math_enabled',
    title: 'Math mode',
    off: 'Off · Start with a single number.',
    on: 'On · Expressions like `1,5+0,5`, `2x3` and `8/2` count.',
  },
  {
    key: 'saves_enabled',
    title: 'Saves',
    off: 'Off: every mistake resets the run.',
    on: `On: a save absorbs a mistake. Earn 1 every ${GAME.saveInterval} (max ${GAME.maxSaves}).`,
  },
  {
    key: 'strict_mode',
    title: 'Strict channel',
    off: 'Off: chatter is allowed in the counting channel.',
    on: 'On: messages that aren’t counts are deleted (needs Manage Messages).',
  },
];

const RUINED_ROLE_DURATIONS = [15, 30, 60, 180, 360, 720, 1440];

function minutesLabel(m) {
  if (m < 60) return `${m} minutes`;
  const h = m / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

function navRow(active, isAdmin) {
  const nav = [
    ['overview', 'Overview', btn('sum')],
    ['leaderboard', 'Leaderboard', btn('highscore')],
    ['player', 'Players', '👤'],
    ['help', 'How to play', '❓'],
  ];
  if (isAdmin) nav.push(['settings', 'Settings', '⚙️']);
  return row(
    ...nav.map(([view, label, emoji]) =>
      button(`sum:nav:${view}`, label, view === active ? ButtonStyle.Primary : ButtonStyle.Secondary, {
        emoji,
        disabled: view === active,
      }),
    ),
  );
}

function nextSaveAt(guild) {
  return (Math.floor(guild.current_count / GAME.saveInterval) + 1) * GAME.saveInterval;
}

/* ───────────────────────────── Overview ───────────────────────────── */

export function overviewView(ctx) {
  const { guild, guildName } = ctx;
  const c = container();

  if (!guild.count_channel_id) {
    c.addTextDisplayComponents(
      text(
        [
          `## ${e('sum')} Sum · ${guildName}`,
          'Sum isn’t counting anywhere yet.',
          ctx.isAdmin
            ? 'Open **⚙️ Settings** to pick a counting channel — a fresh `#sum` channel works great.'
            : 'Ask a server admin to run `/sum` and pick a counting channel.',
        ].join('\n'),
      ),
    );
    return [c, navRow('overview', ctx.isAdmin)];
  }

  const lines = [
    `## ${e('sum')} Sum · ${guildName}`,
    `# ${fmt(guild.current_count)}`,
    `Next up: **${fmt(guild.current_count + 1)}** in ${channel(guild.count_channel_id)}`,
    `Last counted by ${user(guild.last_user_id)}`,
  ];
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addSeparatorComponents(separator());

  const stats = [
    `${e('highscore')} **High score:** ${fmt(guild.high_score)}${guild.high_score_at ? ` · ${ts(guild.high_score_at)}` : ''}`,
    guild.saves_enabled
      ? `🛟 **Saves:** ${guild.saves}/${GAME.maxSaves}${
          guild.saves < GAME.maxSaves ? ` · next one at ${fmt(nextSaveAt(guild))}` : ' · full'
        }`
      : '🛟 **Saves:** off',
    `⏱️ **Run started:** ${ts(guild.run_started_at)}`,
    `🔢 **All-time counts:** ${fmt(guild.total_counts)} · 💥 **Runs ruined:** ${fmt(guild.total_ruins)}`,
  ];
  if (guild.last_ruin_user_id) {
    stats.push(
      `🙈 **Last ruined by** ${user(guild.last_ruin_user_id)} at ${fmt(guild.last_ruin_count)} · ${ts(guild.last_ruin_at)}`,
    );
  }
  c.addTextDisplayComponents(text(stats.join('\n')));
  if (ctx.issues?.length && ctx.isAdmin) {
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`⚠️ ${ctx.issues.join('\n⚠️ ')}`));
  }
  return [c, navRow('overview', ctx.isAdmin)];
}

/* ──────────────────────────── Leaderboard ─────────────────────────── */

const CATEGORY_LABELS = {
  counts: { label: 'Most counts', emoji: '🔢' },
  accuracy: { label: 'Accuracy', emoji: '🎯' },
  streak: { label: 'Best streak', emoji: '🔥' },
  shame: { label: 'Hall of shame', emoji: '💥' },
};

function rankBadge(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `\`#${i + 1}\``;
}

function accuracy(s) {
  const total = s.counts + s.mistakes;
  return total === 0 ? 0 : (s.counts / total) * 100;
}

function leaderboardLine(category, s) {
  switch (category) {
    case 'accuracy':
      return `**${accuracy(s).toFixed(1)}%** · ${fmt(s.counts)} counts`;
    case 'streak':
      return `**${fmt(s.best_streak)}** in a row`;
    case 'shame':
      return `**${fmt(s.ruins)}** ruined · ${fmt(s.mistakes)} mistakes`;
    default:
      return `**${fmt(s.counts)}** counts`;
  }
}

export function leaderboardView(ctx, category = 'counts', page = 0) {
  if (!Object.hasOwn(CATEGORY_LABELS, category)) category = 'counts';
  const board = ctx.store.leaderboard(ctx.guild.guild_id, category, page);
  const meta = CATEGORY_LABELS[category];
  const c = container(category === 'shame' ? ACCENT.danger : ACCENT.brand);

  const header = [`## ${meta.emoji} ${meta.label}`];
  if (category === 'accuracy') header.push(`-# Players with at least ${GAME.accuracyMinCounts} counts.`);
  if (category === 'shame') header.push('-# Who ended the most runs. Wear it with pride.');
  c.addTextDisplayComponents(text(header.join('\n')));
  c.addSeparatorComponents(separator());

  if (board.rows.length === 0) {
    c.addTextDisplayComponents(text('*Nobody here yet. Go count something!*'));
  } else {
    const offset = board.page * GAME.leaderboardPageSize;
    const lines = board.rows.map(
      (s, i) => `${rankBadge(offset + i)} ${user(s.user_id)} — ${leaderboardLine(category, s)}`,
    );
    c.addTextDisplayComponents(text(lines.join('\n')));
  }

  const mine = ctx.store.rankOf(ctx.guild.guild_id, ctx.userId, category);
  c.addTextDisplayComponents(
    text(`-# Page ${board.page + 1}/${board.pages}${mine ? ` · You are #${mine.rank} of ${mine.of}` : ''}`),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('sum:lb:category')
    .setPlaceholder('Pick a leaderboard')
    .addOptions(
      Object.entries(CATEGORY_LABELS).map(([value, m]) => ({
        label: m.label,
        value,
        emoji: m.emoji,
        default: value === category,
      })),
    );
  c.addActionRowComponents(row(select));
  c.addActionRowComponents(
    row(
      button(`sum:lb:page:${category}:${board.page - 1}`, 'Previous', ButtonStyle.Secondary, {
        emoji: '◀️',
        disabled: board.page <= 0,
      }),
      button(`sum:lb:page:${category}:${board.page + 1}`, 'Next', ButtonStyle.Secondary, {
        emoji: '▶️',
        disabled: board.page >= board.pages - 1,
      }),
    ),
  );
  return [c, navRow('leaderboard', ctx.isAdmin)];
}

/* ───────────────────────────── Players ────────────────────────────── */

export function playerView(ctx, targetId = ctx.userId, targetIsBot = false) {
  const c = container();
  const self = targetId === ctx.userId;
  const s = ctx.store.getStats(ctx.guild.guild_id, targetId);
  const rank = s.counts > 0 ? ctx.store.rankOf(ctx.guild.guild_id, targetId, 'counts') : null;

  c.addTextDisplayComponents(text(`## 👤 ${self ? 'Your stats' : 'Player stats'}\n${user(targetId)}`));
  c.addSeparatorComponents(separator());

  if (targetIsBot) {
    c.addTextDisplayComponents(text('*Bots don’t count here. Nice try though.*'));
  } else if (s.counts === 0 && s.mistakes === 0) {
    c.addTextDisplayComponents(
      text(self ? '*You haven’t counted yet. The channel is waiting…*' : '*This player hasn’t counted yet.*'),
    );
  } else {
    c.addTextDisplayComponents(
      text(
        [
          `🔢 **Counts:** ${fmt(s.counts)}${rank ? ` · rank #${rank.rank} of ${rank.of}` : ''}`,
          `🎯 **Accuracy:** ${accuracy(s).toFixed(1)}% (${fmt(s.mistakes)} mistakes)`,
          `🔥 **Best streak:** ${fmt(s.best_streak)} · current ${fmt(s.current_streak)}`,
          `📈 **Highest number counted:** ${fmt(s.highest_number)}`,
          `💥 **Runs ruined:** ${fmt(s.ruins)}`,
          `🕒 **Last count:** ${ts(s.last_count_at)}`,
        ].join('\n'),
      ),
    );
    if (ctx.guild.rule_edit_delete && ctx.store.isDisqualified(ctx.guild.guild_id, targetId, ctx.guild.run_id)) {
      c.addTextDisplayComponents(text('⛔ Benched until the next reset.'));
    }
  }

  const picker = new UserSelectMenuBuilder()
    .setCustomId('sum:player:pick')
    .setPlaceholder('Look up another player…')
    .setMinValues(1)
    .setMaxValues(1);
  c.addActionRowComponents(row(picker));
  return [c, navRow('player', ctx.isAdmin)];
}

/* ─────────────────────────────── Help ─────────────────────────────── */

export function helpView(ctx) {
  const g = ctx.guild;
  const c = container();
  const location = ctx.canViewGame ? channel(g.count_channel_id) : 'the counting channel';
  const rules = [
    '## ❓ How to play',
    `Count up together in ${location}, one number per message, starting at **1**.`,
    'Digits and number emoji both work, like 1️⃣ and 🔟.',
    g.math_enabled
      ? 'Math works too. Try `1+1` or `1,5+0,5` for **2**. Use `.` or `,` for up to two decimal places. The result must be a whole number.'
      : 'Math mode is off. Start with a single whole number such as `2` or `2,00`.',
    'Your message just has to *start* with the count. `42 let’s gooo` is fine.',
  ];
  c.addTextDisplayComponents(text(rules.join('\n')));
  c.addSeparatorComponents(separator());

  const active = [
    '### Rules on this server',
    g.rule_wrong_number
      ? `${e('crossmark')} A wrong number ends the run.`
      : `${e('crossmark')} Wrong numbers are rejected, the run continues.`,
    g.rule_double_count ? '👯 You can’t count twice in a row.' : '👯 Back-to-back counting is allowed.',
    g.rule_edit_delete
      ? '✏️ A text edit or single deletion of the latest count benches its author until the next reset. Bulk deletes only repost the count.'
      : '✏️ Sum reposts the latest count if it is edited or deleted.',
    g.saves_enabled
      ? `🛟 Saves absorb a mistake. Earn one every ${GAME.saveInterval} counts (max ${GAME.maxSaves}).`
      : '🛟 Saves are off — every mistake counts.',
    g.strict_mode ? '🧹 Strict channel: anything that isn’t a count is removed.' : null,
    ctx.canViewGame && g.ruined_role_enabled && g.ruined_role_id
      ? `🎭 Ruin a run and you get <@&${g.ruined_role_id}> for ${minutesLabel(g.ruined_role_minutes)}.`
      : null,
    `🎉 Milestones every ${fmt(GAME.milestoneReaction)}, a party every ${fmt(GAME.milestoneCard)}.`,
  ].filter(Boolean);
  c.addTextDisplayComponents(text(active.join('\n')));
  c.addTextDisplayComponents(text(`-# Sum v${BRAND.version} · more in /about`));
  return [c, navRow('help', ctx.isAdmin)];
}

/* ───────────────────────────── Settings ───────────────────────────── */

const SETTINGS_TABS = [
  ['channels', 'Channels & admins', '📍'],
  ['rules', 'Rules', '📜'],
  ['role', 'Ruined role', '🎭'],
  ['danger', 'Danger zone', '🧨'],
];

function settingsTabs(active) {
  return row(
    ...SETTINGS_TABS.map(([tab, label, emoji]) =>
      button(`sum:settings:${tab}`, label, tab === active ? ButtonStyle.Primary : ButtonStyle.Secondary, {
        emoji,
        disabled: tab === active,
      }),
    ),
  );
}

export function settingsView(ctx, tab = 'channels', extra = {}) {
  switch (tab) {
    case 'setup-channels':
      return settingsChannels(ctx, true);
    case 'setup-rules':
      return ctx.guild.count_channel_id ? settingsRules(ctx, true) : settingsChannels(ctx);
    case 'rules':
      return settingsRules(ctx);
    case 'role':
      return settingsRole(ctx);
    case 'danger':
      return settingsDanger(ctx, extra.confirm);
    default:
      return settingsChannels(ctx);
  }
}

function settingsChannels(ctx, setup = !ctx.guild.count_channel_id) {
  const g = ctx.guild;
  const c = container();
  const intro = setup
    ? [
        `## ${e('sum')} Let’s set up Sum`,
        '### Step 1 of 2 · Choose channels',
        'Pick a text channel for counting. A fresh `#sum` works well. Sum posts a kick-off message when you select it.',
        'Add a log channel and extra admin roles if you need them, then select **Review rules**.',
      ]
    : [
        '## ⚙️ Settings · Channels & admins',
        `📍 **Counting channel:** ${channel(g.count_channel_id)}`,
        `📝 **Log channel:** ${channel(g.log_channel_id)}`,
        `🛡️ **Sum admin roles:** ${
          g.admin_role_ids.length ? g.admin_role_ids.map((r) => `<@&${r}>`).join(' ') : '*none — owner & Manage Server only*'
        }`,
      ];
  c.addTextDisplayComponents(text(intro.join('\n')));
  if (ctx.issues?.length) c.addTextDisplayComponents(text(`⚠️ ${ctx.issues.join('\n⚠️ ')}`));
  c.addSeparatorComponents(separator());

  const setupSuffix = setup ? ':setup-channels' : '';
  const countSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`sum:set:count${setupSuffix}`)
    .setPlaceholder('Counting channel')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (g.count_channel_id) countSelect.setDefaultChannels(g.count_channel_id);

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`sum:set:log${setupSuffix}`)
    .setPlaceholder('Log channel (optional — clear to disable)')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (g.log_channel_id) logSelect.setDefaultChannels(g.log_channel_id);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`sum:set:admins${setupSuffix}`)
    .setPlaceholder('Extra Sum admin roles (optional)')
    .setMinValues(0)
    .setMaxValues(10);
  if (g.admin_role_ids.length) roleSelect.setDefaultRoles(...g.admin_role_ids);

  c.addActionRowComponents(row(countSelect), row(logSelect), row(roleSelect));
  c.addTextDisplayComponents(
    text('-# The server owner and anyone with Manage Server are always Sum admins.'),
  );
  if (setup) {
    c.addActionRowComponents(row(button('sum:settings:setup-rules', 'Review rules', ButtonStyle.Primary, {
      emoji: '📜',
      disabled: !g.count_channel_id,
    })));
  }
  return [c, settingsTabs('channels'), navRow('settings', true)];
}

function settingsRules(ctx, setup = false) {
  const g = ctx.guild;
  const c = container();
  const tab = setup ? 'setup-rules' : 'rules';
  c.addTextDisplayComponents(text(setup
    ? '## 📜 Step 2 of 2 · Review the rules\nRead how each rule works and adjust them for your server. Changes apply as you go.'
    : '## 📜 Settings · Rules\nTap a button to flip a rule. Changes apply instantly.'));
  c.addSeparatorComponents(separator());
  for (const rule of RULES) {
    const on = Boolean(g[rule.key]);
    c.addSectionComponents(
      sectionWithButton(
        `**${rule.title}**\n-# ${on ? rule.on : rule.off}`,
        button(`sum:toggle:${rule.key}:${tab}`, on ? 'On' : 'Off', on ? ButtonStyle.Success : ButtonStyle.Secondary, {
          emoji: btn(on ? 'checkmark' : 'crossmark'),
        }),
      ),
    );
  }
  if (setup) {
    c.addActionRowComponents(row(
      button('sum:settings:setup-channels', 'Back to channels', ButtonStyle.Secondary),
      button('sum:nav:overview', 'Finish setup', ButtonStyle.Success, { emoji: btn('checkmark') }),
    ));
    return [c];
  }
  return [c, settingsTabs('rules'), navRow('settings', true)];
}

function settingsRole(ctx) {
  const g = ctx.guild;
  const c = container();
  const on = Boolean(g.ruined_role_enabled);
  c.addTextDisplayComponents(
    text(
      [
        '## 🎭 Settings · Ruined role',
        'Give whoever ruins a run a temporary role. Make it something fun like **@Ruined It**.',
        '-# Use a dedicated role without permission grants. Sum’s own role must sit **above** it.',
      ].join('\n'),
    ),
  );
  if (ctx.issues?.length) c.addTextDisplayComponents(text(`⚠️ ${ctx.issues.join('\n⚠️ ')}`));
  c.addSeparatorComponents(separator());
  c.addSectionComponents(
    sectionWithButton(
      `**Ruined role** — ${on ? 'enabled' : 'disabled'}\n-# Role: ${
        g.ruined_role_id ? `<@&${g.ruined_role_id}>` : '*none picked*'
      } · Duration: ${minutesLabel(g.ruined_role_minutes)}`,
      button(`sum:toggle:ruined_role_enabled:role`, on ? 'On' : 'Off', on ? ButtonStyle.Success : ButtonStyle.Secondary, {
        emoji: btn(on ? 'checkmark' : 'crossmark'),
        disabled: !on && !g.ruined_role_id,
      }),
    ),
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('sum:set:ruinedrole')
    .setPlaceholder('Pick the ruined role')
    .setMinValues(1)
    .setMaxValues(1);
  if (g.ruined_role_id) roleSelect.setDefaultRoles(g.ruined_role_id);

  const duration = new StringSelectMenuBuilder()
    .setCustomId('sum:set:ruinedminutes')
    .setPlaceholder('How long?')
    .addOptions(
      RUINED_ROLE_DURATIONS.map((m) => ({
        label: minutesLabel(m),
        value: String(m),
        default: m === g.ruined_role_minutes,
      })),
    );
  c.addActionRowComponents(row(roleSelect), row(duration));
  return [c, settingsTabs('role'), navRow('settings', true)];
}

function settingsDanger(ctx, confirm) {
  const g = ctx.guild;
  const c = container(ACCENT.danger);
  c.addTextDisplayComponents(
    text(
      [
        '## 🧨 Settings · Danger zone',
        `**Reset count** — sets the count back to 0${ctx.canViewGame ? ` (currently ${fmt(g.current_count)})` : ''}. High score, saves and player stats stay. Nobody gets blamed.`,
        '**Wipe server data** — deletes every player stat, the high score and all settings for this server. Cannot be undone.',
      ].join('\n'),
    ),
  );
  c.addSeparatorComponents(separator());
  if (g.count_channel_id && !ctx.canViewGame) {
    c.addTextDisplayComponents(text('You need access to the counting channel and **Read Message History** to reset or wipe this game.'));
  } else if (confirm === 'reset') {
    c.addTextDisplayComponents(text('**Really reset the count to 0?**'));
    c.addActionRowComponents(
      row(
        button('sum:danger:reset:yes', 'Yes, reset', ButtonStyle.Danger),
        button('sum:danger:cancel', 'Cancel', ButtonStyle.Secondary),
      ),
    );
  } else if (confirm === 'wipe') {
    c.addTextDisplayComponents(text('**Really wipe everything Sum knows about this server?**'));
    c.addActionRowComponents(
      row(
        button('sum:danger:wipe:yes', 'Yes, wipe it all', ButtonStyle.Danger),
        button('sum:danger:cancel', 'Cancel', ButtonStyle.Secondary),
      ),
    );
  } else {
    c.addActionRowComponents(
      row(
        button('sum:danger:reset', 'Reset count', ButtonStyle.Danger, { emoji: '🔄' }),
        button('sum:danger:wipe', 'Wipe server data', ButtonStyle.Danger, { emoji: '🗑️' }),
      ),
    );
  }
  return [c, settingsTabs('danger'), navRow('settings', true)];
}

/** Shown when a non-admin presses an admin control (e.g. stale panel). */
export function noAccessView(ctx) {
  const c = container(ACCENT.warning);
  c.addTextDisplayComponents(
    text('## 🔒 Admins only\nSettings are for the server owner, Manage Server, and Sum admin roles.'),
  );
  return [c, navRow('overview', false)];
}

export function gameAccessView(ctx) {
  const c = container(ACCENT.warning);
  const message = ctx.guild.count_channel_id
    ? 'You need access to the counting channel and **Read Message History** to view its game and player stats.'
    : 'Ask a server admin to set up a counting channel first.';
  c.addTextDisplayComponents(text(`## 🔒 Game unavailable\n${message}`));
  return [c, navRow('overview', ctx.isAdmin)];
}
