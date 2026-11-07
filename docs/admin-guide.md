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
3. Pick the counting channel. Sum posts a short kick-off message there.
4. *(Optional)* Pick a **log channel**. A private mod channel is ideal.
5. *(Optional)* Add **Sum admin roles**, for example your moderator role.

When Sum joins a server, it DMs the server owner a thank-you note with these steps.

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

Grant **View Audit Log** to Sum if you want it to check single deletions of the latest count for moderation activity. With **Bench count deleters & editors** on, Sum can bench a likely self-delete after a short check. It skips the penalty when a moderator action matches or the audit check is inconclusive. Bulk deletions are reposted without a penalty.

If Sum is missing something, the panel shows a ⚠️ warning. Sum also posts the problem in the log channel and DMs the server owner, at most once a day.

## Rules (⚙️ Settings → 📜 Rules)

| Rule | Default | On | Off |
|---|---|---|---|
| Wrong number ends the run | **On** | Resets the count to 0 (unless a save is used) | Wrong numbers get ❌, the run continues |
| No counting twice in a row | **On** | Back-to-back counting is a mistake | Anyone can count anytime |
| Bench count deleters & editors | **On** | Changing your latest number benches you until the next reset. Likely self-deletes can also bench you with **View Audit Log**. | Sum reposts the count |
| Math mode | **On** | `1+1`, `2x3`, `8/2` … count | Only plain numbers count |
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

- Mount a persistent volume at `/data` (owned by UID 1000). The first upgrade from v0.1.1 or earlier changes the SQLite schema. Back up the database and stop the old container before starting the upgraded one. Keep the pre-upgrade backup if you need to roll back to the older binary. Future overlapping containers must share the same database file.
- Keep the health port internal. `/healthz` checks the gateway and database. `/readyz` also checks that the instance owns the writer lease.
- In the Discord Developer Portal, set Guild Install scopes to `bot` and `applications.commands` and use the six default permissions above (`268512320`). Enable Message Content for counting. Server Members and Presence can stay off.
- Sum prunes local snapshots by age and by `BACKUP_KEEP`. If you enable R2, give its token object read/write access only to the backup bucket. Set an [R2 lifecycle rule](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) to expire objects under `R2_PREFIX` (default `sum/`) after seven days, including when Sum is offline.
