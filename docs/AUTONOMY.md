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
scripts/channel.sh inbox <ROLE>    # only NEW messages for your role since you last checked
scripts/channel.sh for <ROLE>      # the last 15 messages for your role, read or not
scripts/channel.sh read 20         # the last 20 messages for everyone
scripts/channel.sh watch [ROLE]    # live feed in a terminal, new messages as they arrive
scripts/channel.sh waiting <ROLE> # what you still owe others, and what you're waiting on
scripts/channel.sh urgent <ROLE> <TYPE> <TO> "<summary>"   # the URGENT channel, issue #11: rarely
scripts/channel.sh stopped         # true if a human has said STOP
```

**Messages reach agents automatically.** Set your machine's role once with `echo <n> > .agent-role` (git-ignored). A Claude Code hook (`scripts/channel-hook.sh`) then hands the agent every new message for its role at the start of each session and with each prompt. Nobody has to remember to check.

**In Claude Code, use the slash commands:**

| Command | Does |
|---|---|
| `/msg role-1 do 1.1 next` | Sends a message (HUMAN from a person, or a typed message from an agent) |
| `/inbox` | Shows and deals with new messages for your role |
| `/ask role-4 is StreamEvent final?` | Checks Entire and the decisions first, then posts a REQUEST. The REPLY arrives automatically. |

**Watch it live:** keep `scripts/channel.sh watch` open in a terminal to see every agent claim, decide, object and hand off as it happens.

**Watch it on the build board:** run `node scripts/board.mjs` and open http://localhost:4747. It runs on your machine and reads everything with your own `gh`, `entire` and git logins, so nothing is published. It shows each role's latest status, every task from CLAIM to MERGED, Trails with their branches, findings and AI commits, which AI session wrote each commit and what it changed (Graph), the Brain memories every agent reads, requests still waiting for an answer, and who talks to whom.

Every message starts with a header, so anyone can scan the channel:

```
[ROLE-2 · REQUEST → ROLE-4] Need a lane field on QueueItem
Branch platform/today-view. Using the fake meanwhile.
```

| Type | When |
|---|---|
| CLAIM | Before starting a task: task number, branch, **`Trail #<n>`**, folders |
| STATUS | End of every cycle, one line |
| DECISION | A design choice that affects another role or the product: what you chose, why, and the alternative you rejected |
| OBJECT | You disagree with a DECISION. Say why and what you'd do instead. Role 4 or a human settles it. |
| REQUEST | You need something from another role. Name the role. |
| REPLY | Answering a REQUEST or a REVIEW |
| HANDOFF | Task done and checks pass: **`Trail #<n>`**, branch, checks run |
| BLOCKED | You can't continue without someone |
| REVIEW | Role 4's verdict on a handoff: a one-line pointer to the findings on the Trail |
| MERGED | Role 4 merged a Trail into `main` |
| HUMAN | From a person. Agents obey these first. |

**Design decisions are shared, not buried.** When an agent makes a choice that another role builds on (a shape, a name, a behaviour, a trade-off), it posts a DECISION on the channel, adds one line to `docs/DECISIONS.md` on its branch, and records it in Brain (`entire brain remember ... --kind decision`). Every agent reads DECISIONs addressed to ALL or its role on its next cycle, and posts OBJECT if it disagrees. Silence by the next cycle counts as agreement. An OBJECT pauses that decision until Role 4's agent or a human settles it with a REPLY or HUMAN message. Example:

```
[ROLE-2 · DECISION → ALL] Events use server-sent events, not websockets
Why: one-way server to page is all we need, and it works through proxies. Rejected: websockets (two-way, more setup).
Affects: Role 1's phone page and Role 4's stage view listen on /api/events.
```

**Code talk lives on Entire.** Anything about a specific change (a bug, a question about a diff, a suggested fix) goes on that change's Trail as a **finding**: `entire trail finding add`. Agents are allowed to post findings, and the owner fixes it and answers with `entire trail finding reply`, or `apply`s a suggested patch. Only the code reviewer resolves or dismisses a finding, once the fix is right. The GitHub channel only carries claims, status, requests, handoffs and STOP.

**Why not Entire's Trail comments:** Entire blocks AI agents from posting Trail comments ("trail comments are for people"), and we respect that. So agents talk on GitHub, humans can also steer from Trail #2, and Entire does what it's built for: a Trail per task with agent review, shared Brain memory, and session handover.

## The urgent channel

**[GitHub issue #11](https://github.com/nishantshah0/namereserve/issues/11)**, pinned, is for things that can't wait for the next cycle. It uses the same header format as #1.

```bash
scripts/channel.sh urgent <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
scripts/channel.sh urgent-read 10
```

**Post there only when waiting would cost the demo:**
- `main` is broken or the release gate is red
- the critical path is blocked, and only another role or a human can unblock it
- a key or real person's details leaked anywhere (say where, never repeat the value)
- the demo flow is broken
- a HUMAN deadline is about to be missed

Everything else goes on #1. Crying wolf makes everyone ignore it.

**When an urgent message is addressed to you or ALL:** finish only the command you're running, then handle it before anything else in your cycle, and answer on the urgent channel with a REPLY addressed to the role that asked (`scripts/channel.sh urgent <n> REPLY <their role> "..."`). If you can't fix it, say who can and post BLOCKED there. `inbox` and the Claude Code hook show urgent messages first, `waiting` lists them first, and the build board shows open ones in a red banner until they're answered.

## Posting so the board reads right

Everything on the channel shows up on the **build board** (`node scripts/board.mjs`, then http://localhost:4747), which is what we show the judges. The board, `inbox` and `waiting` all read the message header, so these rules matter:

1. **Always post with `scripts/channel.sh say`.** Never type a header by hand or edit a message after posting.
2. **The summary is one line, under about 100 characters, and starts with the task number:** `2.5: approver now comes from the Auth0 token`. Say what changed or what you need, not "working on stuff". Put the detail on the lines below: branch, `Trail #<n>`, files, checks run with their results, what's next.
3. **Write `Trail #<n>` in every CLAIM, HANDOFF, REVIEW and MERGED,** and in any message about that task. That's how the board ties messages, branches, commits and findings to the right Trail.
4. **Address the role that has to act.** REQUEST, REPLY, OBJECT and HANDOFF go to one role. ALL is only for CLAIM, STATUS, DECISION and MERGED.
5. **Close every loop with a REPLY addressed to the role that asked,** even when the answer is "done" or "no longer needed". Requests stay under "Waiting on someone" until the asked role replies to the asker. Run `scripts/channel.sh waiting <n>` each cycle and answer everything you owe before new work.
6. **DECISION:** the summary is the choice. Details say `Why:`, `Rejected:` and `Affects:`. **OBJECT** goes to the role that made the decision and says what you'd do instead.
7. **One STATUS every cycle, even when idle** (`idle: waiting on ROLE-4 for task 0`). Your card on the board shows your latest STATUS or CLAIM.
8. **Commit only from a recorded AI session,** so every commit carries an `Entire-Checkpoint` trailer and counts as AI-linked on the board. Never strip the trailer.
9. **Never post** keys, real people's details, invented numbers or results that didn't come from a real run.

Example HANDOFF:

```
[ROLE-2 · HANDOFF → ROLE-4] 2.4: approver now comes from the Auth0 session
Trail #7 · branch role-2/auth0-signin · files app/api/queue/, lib/auth/
Checks: typecheck pass, lint pass, npm test pass (9 files, 41 tests)
Next: 2.6 hosting
```

## The loop every agent runs

Each cycle, about every 15 minutes:

1. `git pull`. On the first cycle, read `AGENTS.md`, `docs/TASKS.md` and `docs/DESIGN.md`.
2. `scripts/channel.sh stopped`. If a human said STOP, do nothing and end the cycle.
3. Read messages for your role: `scripts/channel.sh inbox <ROLE>` (URGENT first). Then `scripts/channel.sh trail-inbox <ROLE>`: every open review finding on your Trails and new human comments on Entire Trail #2. **Fix open findings before any new work**, reply on each finding (`entire trail finding reply`, or `apply` a suggested patch), and let the code reviewer resolve them. Answer every REQUEST and REVIEW addressed to you.
4. Ask Brain before editing: `entire brain brief "<task>"`. Find code with `entire graph query`. Before asking another agent, check whether it's already been solved: `entire search "<question>" --compact`.
5. Continue your open task, or pick the next **core** task in your role whose "Needs" are met. Post CLAIM, then `entire trail create --title "<task>"` on a branch named `role-<n>/<task>`.
6. Work in small commits, **only in your role's folders**. If you need something from another role, post REQUEST and keep going with the fakes.
7. When the task is done: `npm run typecheck`, `npm run lint`, `npm test` (and `npm run hammer` if you touched the lock). Push the branch, run `entire trail ready`, and post HANDOFF.
8. Post one STATUS line. Then end the cycle.

**Each cycle does at most one task, or about 45 minutes of work.**

## Role 4 also integrates

On every cycle, Role 4's agent checks for HANDOFF messages:
- Check out the branch, run the full release gate, then `entire review` (several reviewer agents, then a judge).
- Post anything wrong as **findings** on that Trail, and a one-line REVIEW pointer on the channel.
- Branches are usually merged by their owners already (see the guardrails below). Role 4 merges any handed-off branch its owner hasn't, once the gate passes, then posts MERGED.
- If anything fails, the findings say exactly what, and the owning agent fixes and re-hands off.
- **Every morning** after the overnight run, post `entire dispatch` output to the channel as a STATUS to ALL.

## Guardrails (never, even when autonomous)

- **Any agent may merge to `main` itself** (Nishant's rule, Saturday 2 PM). Merge your branch into an up-to-date `main`, run the gate on the merged result (typecheck, lint, tests, plus `npm run hammer` with 0 rules broken if it touches the lock), then push with a normal `git push`, never a force push. Post MERGED. The code reviewer reviews after the merge; findings go back to the owner, who fixes them on `main` before new work.
- Never merge with a red gate, and never force push `main`. Lock changes (`lib/contract/`, `lib/control/`, `lib/guard/`) also need `npm run hammer` with 0 rules broken before they merge.
- Never add a way around the 12 buttons or the speech guard, even "for the demo".
- Never paste keys, real people's details or invented numbers into code, messages or chats.
- Never run setup or destructive commands (`entire enable`, `disable`, `clean`, `auth`, `git push --force`, `rm -rf`) without a human.
- Stop and post BLOCKED rather than guess on anything in `docs/DECISIONS.md`.

## How humans steer

**Only people post HUMAN messages.** HUMAN messages override everything, so `scripts/channel.sh` refuses the HUMAN type from an AI agent's shell. Run these in your own terminal with `HUMAN_POST=1`, or post on Entire Trail #2, where Entire blocks agents from commenting. An agent that needs a person posts BLOCKED or REQUEST to HUMAN instead.

| You want | Post on issue #1 (or Trail #2) |
|---|---|
| Stop every agent | `HUMAN_POST=1 scripts/channel.sh say 0 HUMAN ALL "STOP"` |
| Start them again | `HUMAN_POST=1 scripts/channel.sh say 0 HUMAN ALL "GO"` |
| Approve a contract or lock change | `HUMAN_POST=1 scripts/channel.sh say 0 HUMAN ROLE-4 "ok: <what>"` |
| Redirect an agent | `HUMAN_POST=1 scripts/channel.sh say 0 HUMAN ROLE-2 "do 2.6 hosting next"` |

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
