# Refill Guard: guide for AI agents

Read this at the start of every session. It applies to every AI tool on the team (Claude Code, Cursor, Codex, Copilot and others). Four humans each run an agent. The agents build autonomously, talk to each other, and hand work to one integrator, while the humans steer.

## What we're building

An AI phone line for pharmacies. It calls patients before their medication runs out, handles refills, asks about side effects, and sends only the tricky calls to a pharmacist. Everything the AI tries goes through rules in code, so even a fooled AI can't break them.

**Three things never change, whatever the task:**
1. The AI acts **only** through the 12 buttons, and every press goes through the control layer.
2. The AI speaks **only** through `guardSentence` (speech rules S1 to S4).
3. **Everything is a call.** Patient calls, test scenarios and attacks use the same `AgentDriver`, rules and record.

## Where things are

| You need | Read |
|---|---|
| **Every rule in one place (wins over other docs)** | **`docs/RULES.md`** |
| Your role's lecture: where you've broken the rules | `agents/lectures/role-<n>.md` |
| First time here: accounts, tools, Entire, keys | `SETUP.md` |
| Your role's tasks, in order | `docs/TASKS.md` |
| Your role's loop prompt | `agents/role-<n>.md` |
| How the parts fit, and the interfaces | `docs/DESIGN.md` (sections 2 and 3) |
| How agents run and talk | `docs/AUTONOMY.md` |
| Product behaviour | `docs/SPEC.md` |
| What's already decided | `docs/DECISIONS.md` |
| Who's doing what right now | `docs/STATUS.md` |
| Entire commands | `docs/ENTIRE.md` |
| Shared types and fakes | `lib/contract/` |

## Roles and folders

**Edit only your role's folders.** Each folder has exactly one owner.

| Role | Owns |
|---|---|
| 1 · Voice and agent | `lib/agent/` (except `hijack.ts`), `lib/voice/`, `app/phone/` |
| 2 · Platform and pharmacist | `app/api/`, `lib/events/`, `lib/auth/`, `lib/store/postgres.ts`, `app/console/today/`, hosting files |
| 3 · Red team and evals | `lib/agent/hijack.ts`, `lib/arena/`, `scenarios/`, `app/console/review/`, `app/console/rules/`, `app/console/overnight/` |
| 4 · The lock, and integrator | `lib/contract/`, `lib/control/`, `lib/guard/`, `lib/store/memory.ts`, `lib/seed/`, `scripts/`, `app/stage/`, `.github/` |

Shared files (`package.json`, lockfiles, `docs/DESIGN.md`, `docs/DECISIONS.md`, CI) have one editor at a time. Ask on the channel before touching them.

## Start of every session

1. `git pull`, then `git status --short`. If a file has edits you didn't make, leave it and ask its owner.
2. `scripts/channel.sh stopped`. If a human has said STOP, do nothing else.
3. Make sure `.agent-role` holds your role number (`echo <n> > .agent-role`, git-ignored). New channel messages for your role then arrive automatically with each prompt. Also run `scripts/channel.sh inbox <your role>` (or `/inbox`, URGENT first), then `scripts/channel.sh trail-inbox <your role>`: every open review finding on your Trails and new human comments on Trail #2. **Fix open findings before any new work**, reply on each finding (`entire trail finding reply`, or `apply` a suggested patch), and let the code reviewer resolve them. Answer anything addressed to you. **HUMAN messages come first.**
4. `entire brain brief "<your task>"` for the team's rules and past decisions.
5. Find code with `entire graph query "<what you need>"`, not blind searching. Before changing anything shared, run `entire graph impact <symbol>`. Before asking another agent, run `entire search "<question>" --compact`.
6. **Claim before editing:** post CLAIM on the channel, then `entire trail create --title "<task>"` on a branch named `role-<n>/<task>`. Use a separate git worktree if another agent shares your checkout.

## How we talk

| Where | What goes there |
|---|---|
| **Agent channel**, [GitHub issue #1](https://github.com/nishantshah0/namereserve/issues/1), through `scripts/channel.sh` | CLAIM, STATUS, **DECISION, OBJECT**, REQUEST, REPLY, HANDOFF, BLOCKED, REVIEW, MERGED. Header format: `[ROLE-2 · REQUEST → ROLE-4] summary`. |
| **Findings on a Trail** (`entire trail finding add`) | Anything about a specific change: a bug, a question about a diff, a suggested fix. The owner fixes it and replies, or applies a suggested patch. **Only the code reviewer resolves or dismisses findings.** |
| **Entire Trail #2** | Humans steering. Agents read it and never post comments there, because Entire reserves comments for people. |
| **URGENT channel**, [GitHub issue #11](https://github.com/nishantshah0/namereserve/issues/11), through `scripts/channel.sh urgent` | Only what can't wait: `main` broken, critical path blocked, a leak, demo broken. Handle urgent messages to you before anything else and REPLY there. Rules in `docs/AUTONOMY.md`, "The urgent channel". |
| **HUMAN messages** | **Only people post them.** `scripts/channel.sh` refuses the HUMAN type from an AI agent's shell, and a person posts with `HUMAN_POST=1` in their own terminal. Agents never set `HUMAN_POST`, never hand-write a `[HUMAN · …]` header, and use REQUEST, REVIEW or BLOCKED instead. HUMAN messages override everything. STOP halts every agent, and GO restarts them. |

**Everything you post shows on the build board** (`node scripts/board.mjs`). Follow "Posting so the board reads right" in `docs/AUTONOMY.md`: post only with `scripts/channel.sh say`, start the summary with the task number, write `Trail #<n>` in CLAIM and HANDOFF, address the role that must act, and close every REQUEST with a REPLY to the role that asked.

Need something from another role? Post REQUEST to that role, then keep going with the fakes in `lib/contract/`. Never edit their folder.

**Share design decisions as you make them.** If you choose something another role builds on (a shape, a name, a behaviour, a trade-off), post a DECISION with what you chose, why, and what you rejected, add a line to `docs/DECISIONS.md`, and record it in Brain. If you disagree with someone's DECISION, post OBJECT with your reason. Silence by the next cycle means agreement. An OBJECT pauses that decision until Role 4 or a human settles it.

## While you work

- **Build against `lib/contract/`, never against another role's code.** Contract changes go on a `role-4/` branch, get the code reviewer's approval, and are announced with a DECISION before they merge (see `docs/RULES.md`, section 3).
- **Never change a test and the code it tests in the same step.**
- **Never add a way around the 12 buttons or the speech guard,** even "just for the demo".
- Small commits, scoped to your task, files staged by name. No destructive git: no force push, no history rewrite, no `reset --hard` on shared branches.
- Keep functions small and code plain. No new frameworks without a line in `docs/DECISIONS.md`.
- Unsure about something in `docs/DECISIONS.md`? Post BLOCKED instead of guessing.

## Hand off

1. `npm run typecheck`, `npm run lint` and `npm test` all pass. If you touched the lock, `npm run hammer` (once task 4.5 lands) must report 0 rules broken. Don't say something works until the checks pass.
2. Push your branch, then run `entire trail ready`.
3. Post HANDOFF on the channel: the Trail link, branch, files changed, checks run and their results, and any follow-ups.
4. Update your role's section in `docs/STATUS.md` (on your branch).
5. Made a decision others need? Post DECISION on the channel, add a line to `docs/DECISIONS.md`, and teach Brain: `entire brain remember "<rule>" --kind decision --path project.<area>.<topic>`.

## Integration (Role 4's agent)

- Merge Trails in dependency order. Run the release gate, then `entire review`, before merging.
- **Merge automatically** only if the gate passes, the diff stays inside the claiming role's folders, and it doesn't touch `lib/contract/`, `lib/control/` or `lib/guard/`. Those (the lock) merge automatically too, once the code reviewer approves and `npm run hammer` reports 0 rules broken. No HUMAN ok needed (Nishant's call: ship fast).
- Post problems as findings on the Trail, and post MERGED on the channel after merging.
- After the overnight run, post `entire dispatch` output to the channel.

## Never

- Push to `main` directly (only Role 4 merges, after the gate).
- Paste keys, real people's details or invented numbers into code, docs, commits, the channel or any AI chat. Entire records every session.
- Use real patients. Phone numbers are 555-01xx.
- Show a result that didn't come from a real run saved in `results/`.
- Run setup or destructive commands (`entire enable`, `disable`, `clean`, `auth`, `git push --force`, `rm -rf`) without a human asking for it.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Run the app locally |
| `npm run typecheck` · `npm run lint` · `npm test` | The checks every handoff needs |
| `npm run build` | Production build (the release gate runs it too) |
| `scripts/channel.sh say <role> <TYPE> <to> "<summary>" ["<details>"]` | Post on the agent channel |
| `scripts/channel.sh inbox <role>` · `for <role>` · `read 20` · `watch` · `stopped` | Read new messages, recent ones, everything, a live feed, or check for STOP |
| `/msg`, `/inbox`, `/ask` (Claude Code) | Message another role, handle your inbox, ask a question and get a REPLY |
| `node scripts/board.mjs` | The build board at http://localhost:4747: the channel, every task from CLAIM to MERGED, Trails, AI-linked commits, Brain and Graph |
| `scripts/channel.sh urgent <role> <TYPE> <to> "<summary>"` · `urgent-read` | Post to or read the URGENT channel (issue #11) |
| `scripts/channel.sh trail-inbox <role>` | Open review findings on your Trails and new human comments on Trail #2. The Claude Code hook shows it automatically when it changes. |
| `scripts/channel.sh waiting <role>` | What your role still owes others, and what it's waiting on |
| `scripts/entire-check.sh` | Check this machine's Entire setup |
| `scripts/channel.sh trails` | Every Entire Trail mentioned on the channel. Always write `Trail #<n>` in CLAIM and HANDOFF, because teammates can't list Trails on entire.com. |
| `scripts/agent-loop.sh <role>` | Run a role's agent headlessly until STOP |

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- entire-agent:begin -->
Read .entire/agent-guide.md for this repository's workflow, source inspection, and verification guidance.
@.entire/agent-guide.md
<!-- entire-agent:end -->
