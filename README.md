# Refill Guard

[![Release gate](https://github.com/nishantshah0/namereserve/actions/workflows/ci.yml/badge.svg)](https://github.com/nishantshah0/namereserve/actions/workflows/ci.yml)

**Hack Western 13 · submissions close Sunday, November 22, 9:00 AM Eastern**

An AI phone line for pharmacies in progress. The goal is to call patients before medication runs out, handle refills, and send tricky calls to a pharmacist. Rules in code check the agent's actions and speech.

**The line judges should repeat:** *The AI can be fooled. The pharmacy can't.*

**Start here:** [`docs/CURRENT.md`](docs/CURRENT.md) shows what is merged. [`docs/STATUS.md`](docs/STATUS.md) and the agent channel show current work; [`docs/TASKS.md`](docs/TASKS.md) has each role's tasks. The product goal is in [`docs/SPEC.md`](docs/SPEC.md), and parts and ownership are in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Current state

The control layer, guard, in-memory store, Today and Stage pages, typed agent driver, scenario libraries, and hammers are on `main`. The API still uses a fake call driver. The phone page, voice, Postgres store, overnight attacker, and several API endpoints are pending. See [the current architecture and route status](docs/CURRENT.md). Active branches and review findings are tracked in [STATUS.md](docs/STATUS.md) and the [agent channel](https://github.com/nishantshah0/namereserve/issues/1).

---

## Roles and goals

The table shows the original task split and goals. The shared contract is now merged. Check [STATUS.md](docs/STATUS.md) for current owners and work.

| Role | Owns | First task (before sleep) | Done when |
|---|---|---|---|
| **1 · Voice and agent** | The agent loop on Claude, the prompt, the outbound call, the side-effect question, voice in (Chrome) and out (ElevenLabs), turn timing, **the patient phone page**. Calls the guard and safety check, doesn't write them. | A typed agent loop that presses the 12 buttons through the contract's fake | Sam's Concerta refill works typed, start to finish, three times in a row, then by voice on a real phone |
| **2 · Platform and pharmacist** | App shell and API routes, the event stream, the demo clock, reset and daily reminder check, Auth0 (sign-in and roles), the Postgres store, hosting on Vultr with https, the domain, **the pharmacy console's Today view and approvals** | App deployed over https with Auth0 sign-in | A pharmacist approves Sam's refill from the console, and it lands in the record |
| **3 · Red team and evals** | The scripted hijack agent and attack cards, the scenario runner and scoring, the 28 scenarios. After the core: the Gemini attacker, the Fable planner, the judge, the overnight run, the fix loop, cited briefs, and **the console's Review calls, Rules and checks, and Overnight safety tabs** | The hijack agent and the scenario file format, with the first 10 scenarios | Every attack card is blocked, and all 28 scenarios run and score |
| **4 · The lock** | The control layer behind the 12 buttons, rule cards and the strictest-wins engine, triage lanes, the speech guard (S1 to S4) and safety keywords, the hash-chained record, the in-memory store and seed data, the hammers and release gate, **the stage view with the gate animation** | The in-memory store, seed data and the first rules (core rules 1 and 5, card 4b) | The hammers report 0 rules broken against millions of hostile presses, and the gate animation shows it live |

**All four roles write code.** Each role builds and polishes its own screens with Tailwind. The pitch, video and Devpost are done together at the end. **Each role's tasks, in order, are in [`docs/TASKS.md`](docs/TASKS.md).**

**Everyone's AI tool reads [`AGENTS.md`](AGENTS.md) first.** Who owns which folder, and how the pieces connect, is in [`docs/DESIGN.md`](docs/DESIGN.md). Progress and requests go in [`docs/STATUS.md`](docs/STATUS.md). Decisions go in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**The contract (`lib/contract/`) is shared.** Don't change it directly. Propose changes in `docs/STATUS.md`.

## How our agent system works

Four people each run an AI coding agent, one per role. **The agents build autonomously and coordinate with each other.** Four helper agents check their work, and we steer. Every rule is in [`docs/RULES.md`](docs/RULES.md).

```
   Role 1 · Role 2 · Role 3 · Role 4 agents        (each in a ~15 min loop)
        │ CLAIM → build → test → HANDOFF
        ▼
   Agent channel (GitHub issue #1) + URGENT channel (#11)
        │
        ▼
   Code reviewer ──findings on the Entire Trail──▶ owning role fixes ◀── Review fixer (suggested patches)
        │ "approved"
        ▼
   Repo steward merges (Role 4 + a human ok for the lock) ──▶ release gate ──▶ main
        ▲
   Rules police checks every agent against docs/RULES.md and reports violations
```

**One task, start to finish**
1. **Claim:** an agent picks its next task from [`docs/TASKS.md`](docs/TASKS.md), opens an **Entire Trail** for it, and posts a CLAIM on the agent channel.
2. **Context:** before editing, it asks **Entire Brain** for the team's decisions and rules, and **Entire Graph** for where the code is and what depends on it.
3. **Build:** it works only in its own folders, on a `role-<n>/<task>` branch. Every commit is linked to the AI session that wrote it (**Entire Sessions**, an `Entire-Checkpoint` trailer), and tests and code go in separate commits.
4. **Hand off:** typecheck, lint, tests (plus the hammers for the lock), then a HANDOFF naming the Trail.
5. **Review:** the **code reviewer** agent posts every problem as a finding on the Trail and sends it back. The owning role fixes it before any new work. The **review fixer** attaches ready-made patches.
6. **Merge:** once the reviewer approves, the **repo steward** merges it after the release gate. Lock changes (the control layer, speech guard and contract) also need a human ok.

**How the agents talk**
- The **agent channel** (issue #1) carries CLAIM, STATUS, DECISION, OBJECT, REQUEST, REPLY, HANDOFF, REVIEW and MERGED, each with a fixed header. Agents read new messages automatically at every prompt.
- The **URGENT channel** (issue #11) is only for what can't wait: `main` broken, the demo broken, a leak.
- **Design decisions** are posted as DECISIONs, logged in [`docs/DECISIONS.md`](docs/DECISIONS.md) and remembered in Brain, so every agent's next brief includes them.
- **Only people send HUMAN messages.** The tooling refuses them from agents. STOP halts every agent.

**Keeping it honest**
- The **rules police** agent checks every pass for lock changes pushed straight to `main`, unlinked commits, missing Trails, edits outside a role's folders, self-resolved findings and leaked keys. It reports each one to the agent responsible.
- **[`agents/lectures/`](agents/lectures/)** records where each role broke the rules, with numbers, and what it agreed to change.
- The **build board** (`node scripts/board.mjs`) shows it all live: every task from claim to merge, which AI session wrote each commit and what it changed, Brain, Graph, and who's waiting on whom.

Deeper detail: [`docs/AUTONOMY.md`](docs/AUTONOMY.md) (the loop and messages) and [`docs/ENTIRE.md`](docs/ENTIRE.md) (how we use Entire).

---

## Timeline

| When | Goal | Checkpoint |
|---|---|---|
| Sat now to ~5 AM | Interface file, app skeleton, seed data, core rules, stage layout | The hammers report 0 |
| Sat ~5 to 9 AM | Sleep in shifts. Role 1 keeps the agent loop moving. | |
| Sat 9 AM to noon | Typed refill end to end. Someone visits the Sun Life table. | **A typed refill works three times in a row** |
| Sat noon to 4 PM | Speech guard, safety checks, outbound call, side effects, triage, first arena run | First real numbers. **Record a backup video.** |
| Sat 4 to 8 PM | Voice, Auth0 approvals, hijack switch, console | A spoken outbound refill works three times in a row |
| Sat 8 PM to midnight | Only once the core works twice: scenarios and scoreboard, then the attacker and overnight run | The core demo runs twice in a row |
| Sun midnight to 6 AM | Overnight run, final numbers, polish | Final numbers saved |
| Sun 6 to 8:30 AM | No new features. Everyone together: pitch, video, Devpost, five rehearsals. | **Submitted by 8:30 AM** |

## Core demo first

Four people and about 30 hours won't finish everything in the spec. **A team that shows the call, the hijack and the approval working cleanly beats a team that shows ten things half working.**

**Core: build only this until it works twice in a row, end to end.**

1. Sam's call: typed first, then voice
2. The control layer: the 12 buttons, rules 1, 3, 4, 4b, 5, the record, triage lanes
3. The speech guard: S1 to S4
4. The side-effect question, and the Review lane
5. The pharmacist's approval: Auth0 on their phone if it works on the free plan, otherwise Approve in the console
6. The hijack switch, with the four attack cards
7. The console's Today view, the stage view with the gate, and the reset button
8. The hammers reporting 0

**Only after the core works twice**, in this order: the 28 scenarios and scoreboard, the Gemini attacker, the overnight run and fix loop, the rule writer, cited briefs, the Review calls lab, model comparison.

**If the overnight attacker isn't built,** the demo ends after the hijack, at about 2:20, with real numbers from the scripted scenarios instead. Never show attacker numbers that didn't come from a real run.

---

## Stack

| Piece | Choice |
|---|---|
| App | One Next.js app in TypeScript, with Tailwind |
| Tests | Vitest, plus hammer and gate scripts |
| Database | Postgres on Tiger Data |
| Voice | Chrome speech recognition in, ElevenLabs out (Flash model for live turns) |
| AI | Claude for the agent, Fable 5.2 for planning attacks and writing rules, Gemini for the attacker |
| Sign-in and approvals | Auth0 sign-in and roles; pharmacists approve on the console |
| Hosting | Vultr server with automatic https, on a GoDaddy Registry domain |
| Analysis | Optional Python, for charts only |

## Planned layout

```
/app            pages: phone, stage, console
/app/api        API routes and the event stream
/lib/contract   shared types and fakes (the 12 buttons, guard, events, store, agent driver)
/lib/control    buttons, rules, cards, engine, triage
/lib/guard      speech guard S1 to S4, safety keywords
/lib/store      in-memory store first, Postgres later
/lib/agent      agent loop, prompt, hijack, outbound, voice
/lib/arena      scenarios, planner, caller, judge, scoring, fix loop
/scripts        hammers, release gate, overnight run, seed
/docs           SPEC.md
```

## Prize tracks

Overall · Best Health Hack by Sun Life · Best Use of Auth0 · Best Use of Vultr · GoDaddy domain · Best Use of Tiger Data · Best Use of Gemini (if Gemini's role is visible). Ask the organisers how many tracks one project can enter.

---

## Rules for vibe coding this

1. **Vibe the UI, read the lock.** Pages and styling can go fast. Someone reads every line of the control layer, rule cards and speech guard.
2. **Tests before trust.** Nothing in the control layer is done until the hammers say 0 broken.
3. **Never let an AI change a test and the code it tests in the same step.**
4. **Build against the interface file.** Give your AI tool `AGENTS.md`, `docs/TASKS.md` and `lib/contract/` at the start of every session.
5. **One person per area. Commit often, pull often.**
6. **Keys never go in code.** Use `.env`, which is in `.gitignore`. Check before every push, because this repo may go public later.
7. **Made-up patients only.** Phone numbers use 555-01xx.
8. **Only real numbers in the pitch.** If a number didn't come from a real run, it doesn't go on a slide or in Devpost.

## Open questions

- Our teammate's OK to share his story in the pitch, and in what words
- How many prize tracks one project can enter
- How judging works: tables or a stage, and how long per team (we've planned 3 minutes plus 2 of questions)
