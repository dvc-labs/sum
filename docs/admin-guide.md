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
| Embed Links | Rich messages and link previews |
| Manage Messages | *Only for strict channel and benching:* delete chatter and benched players' counts |
| Manage Roles | *Only for roles:* Sum's own colour role and the optional ruined role |

If Sum is missing something, the panel shows a ⚠️ warning. Sum also posts the problem in the log channel and DMs the server owner, at most once a day.

## Rules (⚙️ Settings → 📜 Rules)

| Rule | Default | On | Off |
|---|---|---|---|
| Wrong number ends the run | **On** | Resets the count to 0 (unless a save is used) | Wrong numbers get ❌, the run continues |
| No counting twice in a row | **On** | Back-to-back counting is a mistake | Anyone can count anytime |
| Bench count deleters & editors | **On** | Deleting or editing your latest count benches you until the next reset | Sum only reposts the count |
| Math mode | **On** | `1+1`, `2x3`, `8/2` … count | Only plain numbers count |
| Saves | **On** | A save absorbs a mistake (1 to start, +1 every 200, max 3) | Every mistake counts |
| Strict channel | **Off** | Messages that aren't counts are deleted | Chatter is allowed |

Changes apply immediately and are logged with who made them.

## Roles (⚙️ Settings → 🎭 Roles)

### Sum colour role

Sum gives itself an orange name colour (`#FF4500`) in the member list. Discord doesn't let bots recolour their own role, so Sum creates a small role called **Sum colour** and wears it.

- The role has **no permissions**, isn't shown separately in the member list, and can't be mentioned.
- Sum adds it when it joins, if it has **Manage Roles**. Without that permission it simply doesn't.
- It's **on by default**. Switch it **Off** and Sum deletes the role.
- If you recolour or reposition the role, Sum leaves it alone. If you delete it, Sum treats that as "off" and won't bring it back.
- If you remove Sum from your server, the role is **left behind**, because Sum can't clean up after it has left. Delete it manually (Server Settings → Roles). Re-inviting Sum reuses it.

### Ruined role

1. Create a role, for example **@Ruined It**.
2. In **Server Settings → Roles**, drag **Sum's role above it**. Discord only lets a bot assign roles that sit below its own.
3. Pick the role and a duration (15 minutes to 24 hours), then switch it **On**.

Sum removes the role when the time is up, even if it restarts in the meantime.

## Log channel

Sum logs:

- 💥 ruined runs (who, at what number, why, with a link to the message)
- 🛟 saves used and earned
- 🏆 new high-score runs and 🎉 milestones
- 🕵️ deleted and edited counts
- ⚙️ every settings change and who made it
- ⚠️ permission problems

To turn logging off, clear the log channel picker.

## Danger zone

- **Reset count:** sets the count to 0 without blaming anyone. The high score, saves and player stats stay.
- **Wipe server data:** deletes every player stat, the high score and all settings for this server. **This can't be undone.**

## If the counting channel is deleted

The game pauses. Nothing is lost: the count, the high score and all stats are kept. Sum DMs the server owner and posts in the log channel. Pick a new channel in `/sum` → **⚙️ Settings** and counting carries on where it stopped.

## Removing Sum

Kick Sum like any other bot, then delete the leftover **Sum colour** role if you don't want it (see above). Your server's data is kept for **30 days** in case you change your mind, then deleted permanently. To delete it right away, use **Wipe server data** first.
