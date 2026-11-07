# 🎮 How to play

Everyone in the counting channel counts up together, one number per message. The count starts at **0**, so the first message is **1**.

```
Alex:  1
Sam:   2
Alex:  1+2        ← math counts
Robin: 4
Sam:   5 let's go ← extra text after the number is fine
```

## What counts as a count?

- The message has to **start** with the number or the sum. Anything after it is ignored, so `42 almost there` counts as 42.
- **Math mode** (on by default) supports `+`, `-`, `*`, `x`, `×`, `/`, `÷` and parentheses. `2x3`, `12/4`, `(10-1)*2` all work.
- The result must be a whole number. `3/2` is a wrong count, not chatter.
- `1.5`, `1,000` and similar are wrong counts.
- Messages that don't start with a number or `(` are chatter. Sum ignores them, or deletes them if the server has **strict channel** turned on.

## Reactions

| Reaction | Meaning |
|---|---|
| ✅ (Sum's own checkmark) | Correct |
| ☑️ | Correct, and past the server's previous high score |
| 💯 | Correct, and a multiple of 100 |
| 🎉 | Correct, and a multiple of 1,000 (Sum posts a celebration too) |
| 🛟 | A mistake that a save absorbed. The run continues |
| ❌ (Sum's own crossmark) | Wrong, and the run ended (or the count was rejected) |
| ⛔ | You're benched for this run (see below) |

## Mistakes

These are the default rules. Server admins can switch each one off.

- **Wrong number.** If the next number is 43 and you type 44, the run is over.
- **Counting twice in a row.** Someone else has to count between your turns.

When a run ends, the count goes back to **0** and the next message should be **1**. Your server's high score is kept.

> If the count is still at 0, a wrong number is just rejected. There's nothing to ruin yet.

## 🛟 Saves

A save absorbs one mistake, and the run carries on as if it never happened.

- Every server starts with **1 save**.
- The server earns **1 more save every time the count reaches a multiple of 200** (200, 400, 600 …).
- The bank holds at most **3 saves**.

Run `/sum` to see how many saves you have and when the next one arrives.

## 🕵️ Deleted & edited counts

Deleting or editing your count to confuse people won't work.

- If the **latest** count is deleted, or edited so it shows a different number, Sum reposts it and tells everyone the next number.
- The player who did it is **benched until the next reset**. Their counts are removed (or marked ⛔) until the run ends.
- Adding text to your count without changing the number (`42` → `42 woo`) is fine.
- When a moderator bulk-deletes messages, Sum reposts the count but doesn't bench anyone.

## 🏆 High scores & milestones

- Each server has its own **high score**: the furthest any run has ever reached.
- Passing the previous record triggers a celebration message.
- Every **1,000** gets a party message.

## 🎭 Ruined role

Some servers hand a temporary role, such as **@Ruined It**, to whoever ends a run. It's removed automatically after the time the admins chose.

## Stats

Run `/sum` to see:

- the current count, the high score and your server's saves
- leaderboards: **Most counts**, **Accuracy**, **Best streak**, **Hall of shame**
- your own stats, or any other player's
