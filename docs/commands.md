# 🧭 Commands & the `/sum` panel

Sum has two commands. Everything else happens inside the panel.

| Command | Who | What |
|---|---|---|
| `/sum` | Everyone | Opens the Sum panel. Only you can see it. |
| `/about` | Everyone | Version, support server and links. |

## The `/sum` panel

Use the buttons along the bottom to switch views. Game activity and player stats require **View Channel** and **Read Message History** in the counting channel. Anyone who can open `/sum` can read **How to play**.

### 📊 Overview
The current count, the next number, who counted last, the high score, saves (and when the next one arrives), when this run started, all-time totals, and who ruined the last run.

### 🏆 Leaderboard
Use the menu to pick a board, and the arrows to page through it.

| Board | Ranked by |
|---|---|
| 🔢 Most counts | Correct counts |
| 🎯 Accuracy | Correct ÷ attempts (players with at least 20 counts) |
| 🔥 Best streak | Most correct counts in a row without a mistake |
| 💥 Hall of shame | Runs ruined |

Your own rank appears under the list.

### 👤 Players
Shows your stats. Use **Look up another player…** to see anyone else's: counts, rank, accuracy, streaks, highest number counted, runs ruined, and whether they're currently benched.

### ❓ How to play
The rules as they're currently set on **this** server.

### ⚙️ Settings (admins only)
Only visible to Sum admins. See the [Admin guide](admin-guide.md).

- **📍 Channels & admins:** counting channel, log channel, extra admin roles
- **📜 Rules** covers wrong numbers, double-counting, benching count deleters and editors, math mode, saves and strict channel
- **🎭 Ruined role:** role, duration, on/off
- **🧨 Danger zone:** reset the count, or wipe all server data
