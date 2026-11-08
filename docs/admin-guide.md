# ⚙️ Admin guide

## Who is a Sum admin?

Any one of these is enough:

- the **server owner**
- anyone with **Administrator** or **Manage Server**
- anyone with a role you've added under **⚙️ Settings → Channels & admins → Sum admin roles** (up to 10 roles)

Only Sum admins see the **⚙️ Settings** button in `/sum`.

## First-time setup

1. Create a text channel for counting. **`#sum`** works well, but any name does.
2. Run **`/sum`**. If no counting channel is set yet, admins go straight to the setup screen.
3. Pick the counting channel. Sum posts a short kick-off message there. You can also pick a **log channel** and add **Sum admin roles**.
4. Select **Review rules** to see how the game works and adjust the rules for your server. Changes apply as you make them.
5. Select **Finish setup** to open the game overview.

When Sum joins a server, it DMs the server owner a thank-you note with these steps. If Sum already has **View Audit Log**, it can send the note to the installer.

## Permissions

The invite link asks for these permissions:

| Permission | Why |
|---|---|
| View Channels | See the counting channel |
| Send Messages | Post milestones, records and notices |
| Read Message History | Follow the count |
| Add Reactions | ✅ ❌ 🛟 and friends |
| Manage Messages | Remove chatter in Strict channel mode and delete attempts from benched players |
| Manage Roles | Assign and remove the optional ruined role |

A Sum admin who enables message deletion or moves the game to a channel where Sum will delete messages also needs Discord’s **Manage Messages** permission there.

If Sum is missing something, the panel shows a ⚠️ warning. Sum also posts the problem in the log channel and DMs the server owner, at most once a day.

## Rules (⚙️ Settings → 📜 Rules)

| Rule | Default | On | Off |
|---|---|---|---|
| Wrong number ends the run | **On** | Resets the count to 0 (unless a save is used) | Wrong numbers get ❌, the run continues |
| No counting twice in a row | **On** | Back-to-back counting is a mistake | Anyone can count anytime |
| Bench after edits or deletes | **On** | A text edit or single deletion of the latest accepted count benches its author until the next reset. Bulk deletes only repost the count. | Sum reposts the count and play continues |
| Math mode | **On** | Expressions like `1,5+0,5`, `2x3` and `8/2` count | Sum reads only the leading number |
| Saves | **On** | A save absorbs a mistake (1 to start, +1 every 200, max 3) | Every mistake counts |
| Strict channel | **Off** | Messages that aren't counts are deleted | Chatter is allowed |

Changes apply immediately and are logged with who made them.

## Ruined role (⚙️ Settings → 🎭 Ruined role)

1. Create a dedicated role, for example **@Ruined It**, with no server permissions or channel permission grants. Keep it separate from Sum admin roles.
2. In **Server Settings → Roles**, drag **Sum's role above it**. Discord only lets a bot assign roles that sit below its own.
3. As the server owner or a Sum admin with **Manage Roles** and a role above it, pick the role and duration (15 minutes to 24 hours), then switch it **On**.

Sum removes its own grants when the time is up, even after a restart. If Discord blocks removal, restore Sum’s access so it can retry.

## Log channel

Sum logs:

- 💥 ruined runs (who, at what number, why, with a link to the message)
- 🛟 saves used and earned
- 🏆 new high-score runs and 🎉 milestones
- 🕵️ deleted and edited counts
- ⚙️ every settings change and who made it
- ⚠️ permission problems

Choose a log channel whose members may see the game activity it receives. To select it, you need access to the counting channel and permission to post in the log channel. Clear the picker to turn logging off.

## Danger zone

When a counting channel is configured, both actions require **View Channel** and **Read Message History** there.

- **Reset count:** sets the count to 0 without blaming anyone. The high score, saves and player stats stay.
- **Wipe server data** deletes live player stats, the high score and settings. Sum also queues cleanup for roles it granted. Older backups expire separately.

## If the counting channel is deleted

The game pauses. Nothing is lost: the count, the high score and all stats are kept. Sum DMs the server owner and posts in the log channel. Pick a new channel in `/sum` → **⚙️ Settings** and counting carries on where it stopped.

## Removing Sum

Kick Sum like any other bot. Its live game data is kept for **30 days** in case you change your mind. Use **Wipe server data** first to clear it immediately and give Sum a chance to take back temporary roles before losing access.

## Self-hosting and Coolify

- Mount a persistent volume at `/data` (owned by UID 1000). Back up the database and stop the old container before a schema upgrade, including the upgrade to schema v3 for catch-up. Keep the pre-upgrade backup if you need to roll back to the older binary. Future overlapping containers must share the same database file.
- Keep the health port internal. `/healthz` checks the gateway and database. `/readyz` also checks that the instance owns the writer lease.
- In the Discord Developer Portal, set Guild Install scopes to `bot` and `applications.commands` and use the six default permissions above (`268512320`). Enable Message Content for counting. Server Members and Presence can stay off.
- Schedule backups of `/data` and set retention in Coolify or your hosting platform. For a file-by-file backup, stop all Sum instances sharing the volume before copying it. [SQLite WAL documentation](https://www.sqlite.org/wal.html#the_wal_file)
- When upgrading from a build with in-app backups, remove `BACKUP_HOUR_UTC`, `BACKUP_KEEP` and the old `R2_*` settings from Sum’s app environment. Manage any legacy snapshots in `/data/backups` or Sum’s old R2 prefix through your backup retention policy.

## Counting after downtime

When Sum takes over or reconnects with a fresh Discord session, it checks the counting channel’s history from its saved position. It processes surviving count attempts in message order using the channel’s game rules, including saves and resets. Live attempts for that server wait while the check runs. Sum posts one summary with the next number.

The check uses **View Channel** and **Read Message History**. It processes a backlog of up to **500 channel messages** within a **10-second** recovery window. If the backlog is larger or the read fails or times out, Sum resumes from the saved game state and posts a notice when it can. Failure notices are limited to one per 30 minutes. If many servers reconnect at once and yours does not get a turn to read within the window, Sum skips the check quietly and resumes from the saved state.

History contains the text as it exists when Sum reads it. Catch-up skips deleted messages and applies game state without retroactive reactions, deletes, benches or role grants. The first startup after upgrading to SQLite schema v3 establishes a starting position for existing channels. Moving the game or using **Reset count** also sets a fresh starting position.
