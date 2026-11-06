# Changelog

All notable changes to Sum are listed here. Versions follow [Semantic Versioning](https://semver.org).

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
