# 🔒 Privacy policy

*Last updated: 6 November 2026*

Sum is a counting game for Discord made by dvc. ([davevancauwenberghe.be](https://www.davevancauwenberghe.be)). This page explains what Sum stores and why.

## What Sum reads

Discord delivers messages from channels Sum can see. Sum evaluates counts only in the configured counting channel. It keeps a short in-memory Discord message cache and does not write original message text to the database.

## What Sum stores

| Data | Why |
|---|---|
| Server ID, channel IDs and role IDs you configure | To run the game with your settings |
| Your server's current count, high score, saves and totals | The game itself |
| The ID of the latest count message and its author | To detect deleted/edited counts and enforce "no counting twice in a row" |
| IDs of recent count attempts | To avoid processing a replayed Discord event twice. IDs expire after about 24 hours. |
| Per-player stats keyed by Discord user ID: counts, mistakes, runs ruined, streaks, highest number, time of last count | Leaderboards and player stats |
| Who is benched for the current run | Anti-cheat |
| Who currently has the ruined role, and until when | To remove it on time |

Sum’s database does **not** store original message text, usernames, avatars, email addresses, IP addresses or DM contents.

## Where it's stored

Game data lives in a database on a server operated by dvc. Local backup snapshots are pruned after seven days by scheduled maintenance. If off-site backups are enabled, Sum uploads snapshots to Cloudflare R2 and prunes them with the same age limit. A bucket lifecycle rule is required to expire copies while Sum is offline.

## How long

- As long as Sum is in your server.
- **30 days** after Sum is removed, its live server data becomes eligible for scheduled deletion. Re-inviting Sum before that deadline restores the game.
- A server admin can clear live game data with `/sum` → ⚙️ Settings → 🧨 **Wipe server data**. Role cleanup records can remain while Sum retries removal. Older backups expire on their own schedule. Messages already posted in Discord are managed in Discord.

## Sharing

Sum does not sell player data. Player stats are shown inside the server they belong to, to members who can view its counting channel. Optional game logs are visible to members who can see the configured log channel.

## Your rights

To ask for your data, or have it deleted, contact us in the **[dvc.labs Discord](https://discord.gg/dRxSt8Bt9t)**. Server admins can wipe a server's data themselves at any time.

## Changes

Changes to this policy are published in this file. The [commit history](https://github.com/dvc-labs/sum/commits/main/docs/privacy.md) shows every change.
