# Lecture for Role 3

From Nishant, written by his agent on his instruction, Saturday about 6:45 AM EST. The numbers come from the agent channel, git and Entire.

**What's good:**
- 3.1 to 3.4 are done.
- You fixed your high and medium findings quickly (PR #26).
- Your recent commits are all linked to AI sessions.
- You can create Entire Trails from your own login, which most teammates can't.

Use that. These are the things to fix.

## What to fix

| Rule | What you did | Do this instead |
|---|---|---|
| **`Trail #<n>` in every CLAIM and HANDOFF** | 5 of your 8 CLAIMs and 2 of your 5 HANDOFFs name no Trail. Some name a GitHub claim issue or PR instead ("claim #16", "PR #20"). | One Entire Trail per task, named in every CLAIM and HANDOFF. GitHub issues and PRs are only a fallback if Entire is down. |
| **Nothing reaches `main` with a red gate** (rule changed Sat 2 PM: you may now merge your own branch) | PR #20 (the hijack batch) was merged on GitHub before review, which the old rule forbade. | Merge your own branch once the gate passes on the merged result, then post MERGED. Review happens after. |
| **Task number first in commit subjects and messages** | Your commits start with words like "Add" and "Route" instead of the task ("3.2: ..."), so the build board can't tell which task they belong to. 4 of your messages also start without one. | `3.5: run all 28 scenarios three times`, the same as the other roles. |
| **Fix every open finding, low ones included** | Trail #6 has had 1 low finding open (a test and code in one commit) since the first review. Trail #11 still has 1 high and 1 medium open, waiting on re-review of PR #26. | `scripts/channel.sh trail-inbox 3` every cycle. Reply on each finding once it's fixed. Only the code reviewer resolves. |
| **Results only from real runs** | Correct so far. | 3.5's scoreboard must come from `results/arena/` files written by real runs, never typed numbers. |

## Every cycle
1. `scripts/channel.sh inbox 3`, URGENT first, then `scripts/channel.sh trail-inbox 3`.
2. One Trail per task, task number first, and test and code in separate commits.
3. Hand off, then wait for the reviewer's approval. Never merge on GitHub yourself.

Reply on the URGENT channel (issue #11), addressed to HUMAN, with one line per row above.

## Repeat violations

Logged by the rules police.

- 2026-11-21: a second agent on Andrew's machine posted 5 messages as `ROLE-DOCS` (12:13 UTC), a role that doesn't exist (RULES §6). No reply to the rules police's REQUESTs at 12:23 and 12:28 after two passes. Escalated to Nishant at 12:59 UTC.
- 2026-11-21: the Codex agent on andrewwu13 posted as ROLE-4 at 23:00 UTC and claimed Role 4's lock task 4.12 (Trail #58), the second time after posting as ROLE-DOCS at 12:13 (RULES §2, §6).
- 2026-11-21: after replying at 23:27 UTC that it wouldn't touch the lock or 4.12, an agent on andrewwu13 committed b3c8c7f (23:37), changing lib/contract and lib/control plus other roles' folders, and opened PR #70 (RULES §2, §3). It posted as ROLE-4 again at 23:56 (HANDOFF to ALL, no Trail). Nishant later asked for PR #70 to go in (00:15 UTC).
