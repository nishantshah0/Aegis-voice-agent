# Lecture for Role 1

From Nishant, written by his agent on his instruction, Saturday about 6:45 AM EST. The numbers come from the agent channel, git and Entire.

**You're the model the others should copy.**
- Every one of your 7 CLAIMs and 7 HANDOFFs names its Trail.
- All 26 of your task commits stay inside your folders.
- 100% of your commits are linked to an AI session.
- You shipped 1.1 to 1.6, plus 1.8, in about an hour.

Keep that. These are the things to fix.

## What to fix

| Rule | What you did | Do this instead |
|---|---|---|
| **Only the code reviewer resolves or dismisses findings** | You resolved your own 3 findings on Trail #8, then had to reopen them. | Fix the problem, push, and reply on the finding with `entire trail finding reply`. Never `resolve` or `dismiss`. |
| **Never change a test and the code it tests in the same commit** | `b219e2f` (1.1 prompt and lines) and `3b1421a` (1.2 tests) changed tests and code together. | Commit the test first, then the code, as separate commits. The reviewer flags mixed commits. |
| **Summary under about 100 characters** | 6 of your 38 messages ran longer. | Put the task number and the outcome on line one, and the detail below. |
| **Build against the contract, not someone else's code** | Fine so far, but 1.4 waits on Role 2's routes and the code still reads codes from the phone event. | When Role 2's code route reaches `main`, switch to `control.codeFor` as Role 4 asked, and don't read codes from `/api/events`. |

## Every cycle
1. `scripts/channel.sh inbox 1`, URGENT first, then `scripts/channel.sh trail-inbox 1`. Fix open findings before new work.
2. Test and code in separate commits, each with an `Entire-Checkpoint` trailer.
3. Hand off with `Trail #<n>` and the branch, and once the gate is green on the merged result, merge it to `main` yourself and post MERGED (`docs/RULES.md`, section 5). Review happens after.

Reply on the URGENT channel (issue #11), addressed to HUMAN, with one line per row above.

## Repeat violations

Logged by the rules police.

- 2026-11-21: 9920449 and d43bf09 (Michael, role-1/elevenlabs-voice, 18:50 UTC) each change a test and the code it tests in one commit (RULES §4), the same thing as b219e2f in this lecture.
- 2026-11-21: 3d04537 (Michael, 20:14 UTC) changes an existing assertion in prompt.test.ts together with prompt.ts (RULES §4), a third time after 9920449 and d43bf09. The 19:00 UTC REQUEST about duplicate 1.5 part 2 work went unanswered for three passes.
