# 🔒 Privacy policy

*Last updated: 6 November 2026*

Sum is a counting game for Discord made by dvc. ([davevancauwenberghe.be](https://www.davevancauwenberghe.be)). This page explains what Sum stores and why.

## What Sum reads

Sum receives messages in **every channel it can see**, because that's how Discord delivers them. It only *looks at* messages in your server's configured counting channel, and only to check whether a message starts with a number or a sum. Message text is **never stored**.

## What Sum stores

| Data | Why |
|---|---|
| Server ID, channel IDs and role IDs you configure | To run the game with your settings |
| Your server's current count, high score, saves and totals | The game itself |
| The ID of the latest count message and its author | To detect deleted/edited counts and enforce "no counting twice in a row" |
| Per-player stats keyed by Discord user ID: counts, mistakes, runs ruined, streaks, highest number, time of last count | Leaderboards and player stats |
| Who is benched for the current run | Anti-cheat |
| Who currently has the ruined role, and until when | To remove it on time |

Sum does **not** store message text, usernames, avatars, email addresses, IP addresses or anything from DMs.

## Where it's stored

In a database on a server operated by dvc. Backups are kept for up to 7 days.

## How long

- As long as Sum is in your server.
- **30 days** after Sum is removed from a server, all of that server's data is permanently deleted. Re-inviting Sum within that window restores it.
- A server admin can delete everything at any time with `/sum` → ⚙️ Settings → 🧨 **Wipe server data**.

## Sharing

Sum's data is never sold or shared. Player stats are only shown inside the server they belong to.

## Your rights

To ask for your data, or have it deleted, contact us in the **[dvc.labs Discord](https://discord.gg/dRxSt8Bt9t)**. Server admins can wipe a server's data themselves at any time.

## Changes

Changes to this policy are published in this file. The [commit history](https://github.com/dvc-labs/sum/commits/main/docs/privacy.md) shows every change.
