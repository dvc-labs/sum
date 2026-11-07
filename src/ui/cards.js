import { escapeMarkdown } from 'discord.js';
import { BRAND, GAME } from '../config.js';
import { ACCENT, card, container, fineprint, fmt, linkButton, row, separator, text, ts, user } from './kit.js';
import { btn, e } from './emoji.js';

/* ───────────────────────── Counting channel cards ───────────────────────── */

export function kickoffCard(guild) {
  return card({
    title: `${e('sum')} Sum is live in this channel!`,
    body: [
      `Count up together, one number per message. Next up is **${fmt((guild?.current_count ?? 0) + 1)}**.`,
      (guild?.math_enabled ?? true) ? 'Math works too: `1+1`, `2x2`, `10/2`.' : 'Use plain numbers to count.',
      (guild?.rule_double_count ?? true) ? 'Don’t count twice in a row.' : null,
      'Run `/sum` for stats, leaderboards and the rules.',
    ].filter(Boolean).join('\n'),
    footer: fineprint(),
  });
}

export function mistakeReason(outcome) {
  if (outcome.reason === 'double') return 'counted twice in a row';
  const attempt = outcome.got == null ? 'entered an invalid count' : `typed **${fmt(outcome.got)}**`;
  return `${attempt} but the next number was **${fmt(outcome.expected)}**`;
}

export function ruinedCard(outcome, userId, guild) {
  return card({
    accent: ACCENT.danger,
    title: `💥 ${fmt(outcome.ruinedAt)} — run over!`,
    body: [
      `${user(userId)} ${mistakeReason(outcome)}.`,
      `The count is back to **0**. Start again with **1**.`,
      `🏆 High score: **${fmt(guild.high_score)}**`,
    ].join('\n'),
  });
}

export function savedCard(outcome, userId) {
  return card({
    accent: ACCENT.warning,
    title: '🛟 Save used!',
    body: [
      `${user(userId)} ${mistakeReason(outcome)}.`,
      `A save caught it. **${outcome.savesLeft}** left. Next number is still **${fmt(outcome.expected)}**.`,
    ].join('\n'),
  });
}

export function rejectedNoticeCard(outcome, userId) {
  return card({
    accent: ACCENT.warning,
    body: `${e('crossmark')} ${user(userId)} ${mistakeReason(outcome)}. Next number is **${fmt(outcome.expected)}**.`,
  });
}

export function recordCard(number) {
  return card({
    accent: ACCENT.celebrate,
    title: '🏆 New high score!',
    body: `You just passed the server record. Every number from here on is history — currently **${fmt(number)}**.`,
  });
}

export function milestoneCard(number, guild) {
  const lines = [`**${fmt(number)}** reached together. Absolute legends.`];
  if (guild.saves_enabled) lines.push(`🛟 Saves in the bank: **${guild.saves}/${GAME.maxSaves}**`);
  return card({ accent: ACCENT.celebrate, title: `🎉 ${fmt(number)}!`, body: lines.join('\n') });
}

export function saveEarnedCard(guild) {
  return card({
    accent: ACCENT.success,
    body: `🛟 **Save earned!** You now have **${guild.saves}/${GAME.maxSaves}** saves.`,
  });
}

export function tamperCard(kind, userId, number, benched) {
  return card({
    accent: ACCENT.warning,
    title: kind === 'delete' ? '🕵️ A count vanished' : '🕵️ A count was edited',
    body: [
      `${user(userId)}’s count was ${kind === 'delete' ? 'deleted' : 'edited'}. It was **${fmt(number)}**.`,
      `Next number is **${fmt(number + 1)}**.`,
      benched ? `⛔ ${user(userId)} is benched until the next reset.` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

/* ─────────────────────────────── Log channel ─────────────────────────────── */

export function logCard(title, lines, accent = ACCENT.brand) {
  const c = container(accent);
  c.addTextDisplayComponents(text(`**${title}**\n${lines.filter(Boolean).join('\n')}`));
  c.addTextDisplayComponents(text(`-# ${ts(Date.now(), 'f')}`));
  return c;
}

/* ─────────────────────────────── DMs ─────────────────────────────── */

export function welcomeDm(guildName, addressedToOwner) {
  const c = container();
  c.addTextDisplayComponents(
    text(
      [
        `## ${e('sum')} Thanks for inviting Sum to **${escapeMarkdown(guildName, { maskedLink: true })}**! 🧡`,
        addressedToOwner ? '-# Sent to you as the server owner.' : null,
        'Sum is a classic counting game: your members count up one number at a time, and one mistake can end the run.',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  c.addSeparatorComponents(separator());
  c.addTextDisplayComponents(
    text(
      [
        '### Get counting in 30 seconds',
        '**1.** Create a channel for the game — `#sum` is a great name.',
        '**2.** Run `/sum` in your server and open **⚙️ Settings**.',
        '**3.** Pick your counting channel (and optionally a log channel and admin roles).',
        'That’s it. Someone types **1** and the chaos begins.',
      ].join('\n'),
    ),
  );
  c.addSeparatorComponents(separator());
  c.addTextDisplayComponents(text('Questions, ideas or bugs? Come say hi in the **dvc.labs** server.'));
  c.addActionRowComponents(
    row(
      linkButton('dvc.labs support', BRAND.supportInvite, btn('dvc')),
      linkButton('How Sum works', BRAND.docs, '📖'),
    ),
  );
  c.addTextDisplayComponents(text(`-# ${fineprint()}`));
  return c;
}

export function ownerAlertDm(guildName, title, lines) {
  const c = container(ACCENT.warning);
  c.addTextDisplayComponents(
    text([`## ⚠️ ${title}`, `-# Server: **${escapeMarkdown(guildName, { maskedLink: true })}**`, ...lines].join('\n')),
  );
  c.addActionRowComponents(row(linkButton('Get help', BRAND.supportInvite, btn('dvc'))));
  c.addTextDisplayComponents(text(`-# ${fineprint()}`));
  return c;
}

/* ─────────────────────────────── /about ─────────────────────────────── */

export function aboutCard({ guildCount, invite }) {
  const c = container();
  c.addTextDisplayComponents(
    text(
      [
        `## ${e('sum')} Sum · v${BRAND.version}`,
        'A classic counting game for Discord. Count up together, one number at a time — math allowed, mistakes punished, records celebrated.',
      ].join('\n'),
    ),
  );
  c.addSeparatorComponents(separator());
  c.addTextDisplayComponents(
    text(
      [
        `🔢 Counting in **${fmt(guildCount)}** server${guildCount === 1 ? '' : 's'}`,
        '🧭 Everything lives in one command: `/sum`',
        '💬 Support, feedback and updates in the **dvc.labs** Discord',
      ].join('\n'),
    ),
  );
  c.addActionRowComponents(
    row(
      linkButton('dvc.labs Discord', BRAND.supportInvite, btn('dvc')),
      linkButton('dvc.', BRAND.website, btn('dvc')),
      linkButton('GitHub', BRAND.repo, '📖'),
      linkButton('Add Sum', invite, btn('sum')),
    ),
  );
  c.addTextDisplayComponents(text(`-# ${fineprint()}`));
  return c;
}
