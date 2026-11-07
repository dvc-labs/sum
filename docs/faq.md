# ❓ FAQ

**Sum doesn't react to anything.**
Check that you're in the channel set under `/sum` → ⚙️ Settings, and that Sum can **View Channel**, **Read Message History** and **Add Reactions** there. The Settings screen lists anything that's missing.

**Two people typed the same number at the same moment. Who wins?**
Whoever's message Discord delivers first. Sum handles messages strictly one at a time, so only one can be accepted. The other is treated as a mistake (usually caught by a save, if there's one left).

**Can I count with words, like "one, two, three"?**
Not yet. Numbers and math only.

**Why wasn't `1.5` or `1,000` accepted?**
Counts are whole numbers without separators. Type `1000`, or be fancy with `10x100`.

**I edited a typo in my count and got benched.**
Only edits that change the number count as tampering. If your edit changed `42` into `43`, Sum has to assume something fishy. You're back in after the next reset.

**A moderator deleted my count and now I'm benched.**
Discord doesn't tell bots who deleted a message, so Sum assumes it was the author. Bulk deletes (purges) never bench anyone. An admin can turn off **Bench count deleters & editors**, or use **Reset count** to clear all benches.

**How do saves work again?**
1 to start, +1 each time the count reaches a multiple of 200, max 3. Each save absorbs one mistake. See [How to play](how-to-play.md#-saves).

**The ruined role isn't being given out.**
Drag Sum's role **above** the ruined role in Server Settings → Roles, and make sure Sum has **Manage Roles**.

**What is the "Sum colour" role?**
A role with no permissions that gives Sum its orange name colour. Discord doesn't let bots recolour their own role, so Sum uses this one instead. Turn it off in `/sum` → ⚙️ Settings → 🎭 Roles and Sum deletes it. If you remove Sum from your server, delete the role yourself. Details in the [Admin guide](admin-guide.md#sum-colour-role).

**Can I have more than one counting channel?**
One per server for now.

**Is there a global leaderboard across servers?**
Not yet. If it ever arrives, it'll be opt-in.

**Can I set the count to a specific number?**
No. Only **Reset count** (to 0) is available, to keep things fair.

**I removed Sum by accident. Is our count gone?**
No. Re-invite it within 30 days and everything is still there.

**Where do I report bugs or suggest features?**
In the **[dvc.labs Discord](https://discord.gg/dRxSt8Bt9t)**, or as a [GitHub issue](https://github.com/dvc-labs/sum/issues).
