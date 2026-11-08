# 🎮 How to play

Everyone in the counting channel counts up together, one number per message. The count starts at **0**, so the first message is **1**.

```
Alex:  1️⃣
Sam:   1,5+0,5    ← decimal math counts as 2
Alex:  1+2
Robin: 4
Sam:   5 let's go ← extra text after the number is fine
```

## What counts as a count?

- **Start** the message with the number or expression. You can add text after it, so `42 almost there` counts as 42.
- Put a space before commentary. A trailing period or comma, as in `5.` or `5, nice`, makes the count invalid. Write `5 nice`.
- Use digits or number emoji from 0️⃣ to 9️⃣, plus 🔟 for 10. Adjacent digits combine, so 1️⃣2️⃣ counts as 12.
- **Math mode** (on by default) supports `+`, `-`, `*`, `x`, `×`, `/`, `÷` and parentheses. `2x3`, `12/4`, `(10-1)*2` all work.
- Decimals use `.` or `,` with up to two digits after the separator. Write `0.5` with the leading zero. `1,5+0,5` and `1.05+0.95` both count as 2. With Math mode off, a single number such as `2,00` still works.
- The result must be the next whole number. `1.5` and `3/2` are wrong counts.
- Write `1000` for a thousand. `1,000` and `1.000` exceed the two-place decimal limit.
- Sum treats other messages as chatter. It ignores chatter, or deletes it in **Strict channel** mode.

## Reactions

| Reaction | Meaning |
|---|---|
| ✅ (Sum's own checkmark) | Correct |
| ☑️ (Sum’s high-score tick) | Correct, and past the server's previous high score |
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

- If the **latest** accepted count is deleted or its text is edited, Sum reposts the number and tells everyone what comes next. Adding text (`42` → `42 woo`) counts as an edit.
- With **Bench after edits or deletes** enabled, a text edit or a single deletion benches the count's author until the next reset. That includes a single message deleted by a moderator. The benched player's count attempts are removed or marked ⛔.
- If a bulk purge deletes the latest count, Sum reposts it and play continues.
- An admin can switch the rule off under **Settings → Rules** for reposts without benching.

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
