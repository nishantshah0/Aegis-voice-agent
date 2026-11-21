# Autonomous build: how our agents run and talk

Each of us runs an AI agent in a loop. The agents pick their own next task, build it, test it, hand it off, ask each other for things, review each other's work, and merge, while we steer.

```
           ┌────────────── GitHub issue #1: the agent channel ──────────────┐
           │  CLAIM · STATUS · REQUEST · REPLY · HANDOFF · REVIEW · MERGED  │
           └───▲──────────────▲──────────────▲──────────────▲──────────────┘
               │              │              │              │
          Role 1 agent   Role 2 agent   Role 3 agent   Role 4 agent (merges)
               │              │              │              │
           Entire: a Trail per task · Brain (shared rules) · session resume
               │              │              │              │
           task branch ──▶ release gate (typecheck, lint, tests, hammers) ──▶ main
                                                     ▲
                    Humans steer: HUMAN messages on #1, or on Entire Trail #2
```

## Where they talk

**[GitHub issue #1](https://github.com/nishantshah0/namereserve/issues/1)**, pinned, is the agent channel. Use the helper:

```bash
scripts/channel.sh say <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
scripts/channel.sh for <ROLE>      # messages to your role, to ALL, and from humans
scripts/channel.sh read 20         # the last 20 messages
scripts/channel.sh stopped         # true if a human has said STOP
```

Every message starts with a header, so anyone can scan the channel:

```
[ROLE-2 · REQUEST → ROLE-4] Need a lane field on QueueItem
Branch platform/today-view. Using the fake meanwhile.
```

| Type | When |
|---|---|
| CLAIM | Before starting a task: task number, branch, Trail, folders |
| STATUS | End of every cycle, one line |
| REQUEST | You need something from another role. Name the role. |
| REPLY | Answering a REQUEST or a REVIEW |
| HANDOFF | Task done and checks pass: Trail link, branch, checks run |
| BLOCKED | You can't continue without someone |
| REVIEW | Role 4's verdict on a handoff: what failed, or "merging" |
| MERGED | Role 4 merged a Trail into `main` |
| HUMAN | From a person. Agents obey these first. |

**Why not Entire's Trail comments:** Entire blocks AI agents from posting Trail comments ("trail comments are for people"), and we respect that. So agents talk on GitHub, humans can also steer from Trail #2, and Entire does what it's built for: a Trail per task with agent review, shared Brain memory, and session handover.

## The loop every agent runs

Each cycle, about every 15 minutes:

1. `git pull`. On the first cycle, read `AGENTS.md`, `docs/TASKS.md` and `docs/DESIGN.md`.
2. `scripts/channel.sh stopped`. If a human said STOP, do nothing and end the cycle.
3. Read messages for your role (`scripts/channel.sh for <ROLE>`) and human steering on Entire Trail #2 (`entire trail comment list --trail 2`). Answer every REQUEST and REVIEW addressed to you.
4. Ask Brain before editing: `entire brain brief "<task>"`. Find code with `entire graph query`.
5. Continue your open task, or pick the next **core** task in your role whose "Needs" are met. Post CLAIM, then `entire trail create --title "<task>"` on a branch named `role-<n>/<task>`.
6. Work in small commits, **only in your role's folders**. If you need something from another role, post REQUEST and keep going with the fakes.
7. When the task is done: `npm run typecheck`, `npm run lint`, `npm test` (and `npm run hammer` if you touched the lock). Push the branch, run `entire trail ready`, and post HANDOFF.
8. Post one STATUS line. Then end the cycle.

**Each cycle does at most one task, or about 45 minutes of work.**

## Role 4 also integrates

On every cycle, Role 4's agent checks for HANDOFF messages:
- Check out the branch and run the full release gate.
- **Merge automatically** only if the gate passes, the diff stays inside the claiming role's folders, and it doesn't touch `lib/contract/`, `lib/control/` or `lib/guard/`. Then post MERGED.
- **Wait for a HUMAN "ok"** for anything touching the contract or the lock.
- If anything fails, post REVIEW to that role with exactly what failed.

## Guardrails (never, even when autonomous)

- Never push to `main` directly. Only Role 4 merges, after the gate.
- Never edit `lib/contract/` without a HUMAN "ok" on a contract change request.
- Never add a way around the 12 buttons or the speech guard, even "for the demo".
- Never paste keys, real people's details or invented numbers into code, messages or chats.
- Never run setup or destructive commands (`entire enable`, `disable`, `clean`, `auth`, `git push --force`, `rm -rf`) without a human.
- Stop and post BLOCKED rather than guess on anything in `docs/DECISIONS.md`.

## How humans steer

| You want | Post on issue #1 (or Trail #2) |
|---|---|
| Stop every agent | `scripts/channel.sh say 0 HUMAN ALL "STOP"` |
| Start them again | `scripts/channel.sh say 0 HUMAN ALL "GO"` |
| Approve a contract or lock change | `scripts/channel.sh say 0 HUMAN ROLE-4 "ok: <what>"` |
| Redirect an agent | `scripts/channel.sh say 0 HUMAN ROLE-2 "do 2.6 hosting next"` |

## Starting your agent

**Claude Code (recommended):** open a new session in the repo and run:

```
/loop Follow agents/role-<n>.md. Run one cycle of the loop in docs/AUTONOMY.md, then wait for the next cycle.
```

**Headless (any machine, runs until STOP):**

```bash
scripts/agent-loop.sh <role-number>
```

**Cursor, Codex or other tools:** give your agent `agents/role-<n>.md` as its instructions and ask it to run one cycle every 15 minutes.

Each person keeps their agent supervised: glance at the channel, answer BLOCKED messages, and say STOP if it goes off course.

## Cost and safety

- A loop calls your AI tool every cycle, so it spends tokens. Keep the cycle at 15 minutes or more, and STOP loops while you sleep unless someone is watching.
- Every session is captured by Entire, with transcripts in the private sessions repo. The channel is a GitHub issue in a private repo, and becomes public if the repo does.
