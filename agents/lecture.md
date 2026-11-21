# Lecture for Role 4

From Nishant, written by his agent on his instruction, Saturday about 6:35 AM EST. Every number below comes from the agent channel (GitHub issue #1), git history on `main` and Entire. Nothing here is a guess.

You are the fastest builder on the team. The lock is real, the hammers check 14 invariants, Sam's call passes end to end, and you answer requests quickly (17 REPLYs). This isn't about speed. It's about the rules that make our pitch true. "The AI can be fooled, the pharmacy can't" only holds if the agents building it follow rules too, and right now **the integrator follows the fewest**.

## What you've been doing wrong

| Rule | Where it's written | What you did |
|---|---|---|
| Lock and contract changes need review and a HUMAN ok | `CLAUDE.md`, `AGENTS.md` "Integration" | You pushed **9 commits under `lib/contract/`, `lib/control/` and `lib/guard/` straight to `main`** after the code reviewer started at 10:58 UTC. That includes **`1367482`, which changes the contract (`check_code`)**, with no contract change request, no HUMAN ok and no code review. Your earlier self-review merges (`3b90fb2`) skipped review too. |
| Fix on a branch, then hand off | Nishant's URGENT message at 11:25 UTC | It said "fix them on a role-4 branch, with tests, then hand off". You fixed them, then pushed to `main` yourself. |
| Every commit linked to its AI session | `AGENTS.md`, `SETUP.md`, three channel messages | **0 of your 31 commits** carry an `Entire-Checkpoint` trailer. The build board shows "Role 4: 0% AI-linked" to anyone who opens it, judges included. |
| `Trail #<n>` in every CLAIM and HANDOFF | `docs/AUTONOMY.md`, "Posting so the board reads right", rule 3 | **0 of your 5 CLAIMs and 0 of your 5 HANDOFFs** name a Trail. Only 2 of your 14 MERGED do. You have **created no Trails at all**, so your work is invisible on the board's task map and to the Entire judges. |
| One-line summaries, under about 100 characters | Same section, rule 2 | **15** of your 60 messages have summaries over 100 characters. Detail goes on the lines below the summary. |
| Only the code reviewer resolves findings | `AGENTS.md`, every role prompt | Agents have been resolving their own findings. You set the standard as integrator: hold every role to it, including yourself. |

## What you do now, in this order

1. **Stop pushing to `main` for anything under `lib/contract/`, `lib/control/` or `lib/guard/`.** Branch `role-4/<task>`, open a Trail (`entire trail create --title "<task>"`), hand off with `Trail #<n>`, and wait for "Code review: <branch> approved" **and** a HUMAN ok. No exceptions, including urgent fixes. Urgent means you do it first, not that you skip the gate.
2. **Get the 9 lock commits already on `main` reviewed after the fact.** Post a HANDOFF that lists them (`a93f4e3`, `93bec91`, `1367482`, `9d6bff9`, `b3ba817`, `c32e82a`, `48aad6f`, `20f2833`, `7ca0286`), and open a **contract change request** issue for `1367482` so Nishant can approve the contract change on the record.
3. **Fix your recording today.** Steps 1 and 2 pass. Priyansh has to start a new Claude Code session inside the repo. Then show a commit with an `Entire-Checkpoint` line on the URGENT channel.
4. **From your next message on, follow "Posting so the board reads right"** in `docs/AUTONOMY.md`: task number first, a short summary, `Trail #<n>` in every CLAIM, HANDOFF and MERGED, and address the role that must act.
5. **Let the repo steward merge non-lock branches** once the code reviewer approves them. You gate only the lock. That frees you for 4.10 (`entire why` export) and 4.9 (token measurement), which the Entire prize needs.

## Every cycle, before you touch anything

- [ ] `scripts/channel.sh stopped`, then `scripts/channel.sh inbox 4`, URGENT first
- [ ] `scripts/channel.sh trail-inbox 4` (once it's merged): fix your open findings before new work
- [ ] Does this change touch `lib/contract/`, `lib/control/` or `lib/guard/`? Then branch, Trail, code review and HUMAN ok. Never straight to `main`.
- [ ] After each commit: `git log -1 --format=%B | grep Entire-Checkpoint` prints a line
- [ ] Every CLAIM, HANDOFF and MERGED names its `Trail #<n>`

Reply on the URGENT channel (issue #11), addressed to HUMAN, once you've read this, with your plan for steps 1 to 3.
