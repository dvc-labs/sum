# Changelog

All notable changes to Sum are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [0.1.2] — 2026-11-07

- Require counting-channel access and Read Message History for game stats, resets and wipes. Keep help open to all members. Request Manage Messages and Manage Roles up front and check Discord permissions for delegated moderation and ruined-role configuration.
- Repost deleted counts and check likely self-deletes with optional View Audit Log. Preserve edit benching and process count, edit and delete state in order.
- Keep temporary role cleanup through wipes and permission failures. Respect existing manual grants.
- Wait for Discord readiness before a deploy takes over, fence game writes in SQLite and deduplicate replayed counts.
- Acknowledge settings changes before waiting for work. Process Discord notifications separately from count state, keep save and ruin notices under load, and calculate leaderboard ranks in SQLite.
- Sanitize request errors and wrong-count notices while retaining local exception diagnostics. Expire snapshots by age locally and in R2 when configured. Prune abandoned partial snapshots.

## [0.1.1] — 2026-11-07

### Added
- **Custom emoji.** Sum now uses its own emoji across the bot:
  - a custom **checkmark** and **crossmark** for count reactions, the "wrong number" lines and the On/Off rule toggles
  - the **Sum logo** in headings, the Overview button, kick-off, welcome and `/about` cards, and the "Add Sum" button
  - the **dvc. logo** on the support, website and help buttons and in the fine print
- Safe fallback: if a custom emoji ever can't be shown, Sum uses ✅ ❌ 🔢 🧡 instead, so reactions and cards keep working.
- Sum checks its emoji at startup and notes any problem in its logs.

## [0.1.0] — 2026-11-06

The first public release. 🎉

### Added
- Classic counting from 0, with **math mode** (`1+1`, `2x3`, `8/2`, parentheses). Expressions are evaluated safely and exactly.
- Fail rules that can each be switched on or off: **wrong number** and **counting twice in a row**.
- **Saves:** 1 to start, +1 at every multiple of 200, up to 3.
- **Per-server high score**, a celebration when it's beaten, and ☑️ reactions past the old record.
- Milestone reactions every 100 (💯) and a celebration every 1,000 (🎉).
- **Anti-cheat:** deleted or edited counts are reposted, and the player who did it can be benched until the next reset.
- **Strict channel** mode (off by default) that removes messages that aren't counts.
- Optional **ruined role** with a configurable duration that survives restarts.
- **Leaderboards:** most counts, accuracy, best streak, Hall of shame.
- **Player lookup:** your own stats, or anyone else's.
- `/sum`: a single private panel with Overview, Leaderboard, Players, How to play and Settings.
- **Admin settings:** counting channel, log channel and admin roles. Owner and Manage Server are always admins.
- **Log channel** for ruined runs, saves, records, tampering, settings changes and permission problems.
- Owner DM when the counting channel is deleted or Sum loses permissions.
- Thank-you DM on first install.
- `/about` with the version, support server and links.
- Danger zone: reset count, wipe server data.
- Server data is kept for 30 days after Sum is removed, then purged.
- Updates without downtime: during a deploy, only one running copy of Sum handles the game.
