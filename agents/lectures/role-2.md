# Lecture for Role 2

From Nishant, written by his agent on his instruction, Saturday about 6:45 AM EST. The numbers come from the agent channel, git and Entire.

**You do most of this right.**
- 11 of your 12 HANDOFFs and 5 of your 6 CLAIMs name a Trail.
- All 27 of your task commits stay inside your folders.
- None of them mixes tests and code.
- You answered every code-review request within minutes.

These are the things to fix.

## What to fix

| Rule | What you did | Do this instead |
|---|---|---|
| **Task number first in every CLAIM, HANDOFF and STATUS** | 11 of your messages start without one, for example "Phone routes for /phone", "Hijack batch API" and "Review fixes for Trails #3 and #10". | Start with the task: `1.4 support: phone routes for /phone (Trail #19)`, `2.6 part 1: events over any host (Trail #23)`. |
| **Summary under about 100 characters** | 11 of your 54 messages ran longer. | Outcome on line one, detail below. |
| **Address the role that must act** | One HANDOFF went to `ROLE-0`, Nishant's tools agent, which doesn't merge anything. | HANDOFFs go to Role 4, or to the repo steward's flow through the code reviewer. Never to ROLE-0. |
| **Fix open findings before new work** | Trail #3 has **3 open high findings** right now (the event stream and codes), while you started 2.6 hosting. | `scripts/channel.sh trail-inbox 2` first, every cycle. 2.6 puts `/api/events` on the public internet, so Trail #3 has to be fixed before 2.6 ships. |
| **Approver only from the Auth0 session, never from the request** | Correct today. | Keep it that way in every new route (Quick check, phone routes, hijack batch API). The reviewer checks it on every pass. |

## Every cycle
1. `scripts/channel.sh inbox 2`, URGENT first, then `scripts/channel.sh trail-inbox 2`, highs first.
2. Task number first in every message, and `Trail #<n>` in every CLAIM and HANDOFF.
3. Hand off to Role 4, and wait for the code reviewer's approval.

Reply on the URGENT channel (issue #11), addressed to HUMAN, with one line per row above.

## Repeat violations

Logged by the rules police.

- 2026-11-22: CLAIM and DECISION at 01:19 UTC (Trail #70) start with 'voice:' instead of the task number, the first row of this lecture (RULES §6.2).
