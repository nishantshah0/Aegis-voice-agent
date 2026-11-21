<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg">
    <img src="public/brand/logo.svg" alt="Aegis" height="56">
  </picture>
</p>

<h3 align="center">The AI can be fooled. The pharmacy can't.</h3>

<p align="center">
  An AI phone line for pharmacies. Aegis calls patients before their medication runs out, handles the refill, and sends only the tricky calls to a pharmacist. Every action the AI tries passes through rules written in code.
</p>

<p align="center">
  <a href="https://github.com/nishantshah0/namereserve/actions/workflows/ci.yml"><img src="https://github.com/nishantshah0/namereserve/actions/workflows/ci.yml/badge.svg" alt="Release gate"></a>
  <img src="https://img.shields.io/badge/rules_broken-0-0A7A4B" alt="0 rules broken">
  <img src="https://img.shields.io/badge/Next.js-16-0C0F0E" alt="Next.js 16">
  <img src="https://img.shields.io/badge/TypeScript-strict-0C0F0E" alt="TypeScript">
  <img src="https://img.shields.io/badge/Claude-agent-0C0F0E" alt="Claude">
  <img src="https://img.shields.io/badge/license-MIT-0C0F0E" alt="MIT license">
  <img src="https://img.shields.io/badge/Hack_Western-13-0A7A4B" alt="Hack Western 13">
</p>

<p align="center"><img src="docs/images/landing.png" alt="The Aegis landing page: the headline, the patient's call screen and the pharmacist's Review lane" width="900"></p>

<p align="center"><sub>Aegis (formerly Refill Guard) · Hack Western 13 · demo data only, no real patients</sub></p>

## How it works

1. **It calls before the bottle runs out.** A daily check finds patients who are nearly out and rings them. The AI verifies a code and date of birth, takes the refill and asks about side effects.
2. **Hard rules live in code, not in the prompt.** The AI can press 12 buttons and nothing else. Every press goes through the control layer and its rule cards (strictest wins), and every sentence through the speech guard (S1 to S4). A fooled AI still hits the same wall.
3. **A pharmacist sees only the tricky calls.** Each call lands in a lane: Automatic, Quick check or Review. Controlled drugs, side effects and blocked lines wait for a pharmacist, who approves in the console after signing in with Auth0.

```mermaid
flowchart LR
  P["Patient's phone"] <-->|voice or text| A["Agent<br/>(Claude)"]
  A -->|"presses 1 of 12 buttons"| C["Control layer<br/>rule cards, strictest wins"]
  A -->|"every sentence"| G["Speech guard<br/>S1 to S4"]
  G -->|"checked line"| P
  C --> R[("Hash-chained record")]
  G --> R
  C -->|"Review / Quick check"| Q["Pharmacist console<br/>Auth0 sign-in"]
  Q -->|"approve or deny"| R
  H["Hammers and AI attacker"] -.->|"hostile presses"| C
```

| | | |
|---|---|---|
| <img src="docs/images/phone.png" alt="The patient's phone during a call"> | <img src="docs/images/console.png" alt="The pharmacist console"> | <img src="docs/images/stage.png" alt="The stage: every press at the gate"> |
| **Patient phone** `/phone` | **Pharmacist console** `/console/today` | **The stage** `/stage` |

## The numbers

From the last hammer run, [`results/hammer-latest.json`](results/hammer-latest.json): **0 rules broken** across **77,648** hostile press sequences (**275,098** presses, **379,902** rule checks). Every sequence of up to 3 presses from every starting state, plus 10,000 long random sequences. Real runs only: no number in this README or the pitch is estimated.

The live agent so far, from [`results/tokens-latest.json`](results/tokens-latest.json) (`node scripts/tokens.ts` sums [`results/agent-usage.jsonl`](results/agent-usage.jsonl)): **41** agent turns on `claude-haiku-5-5`, **72** model calls, **997,770** input tokens (**747,728** of them cache reads) and **10,442** output tokens, **$0.53** as reported by the Agent SDK.

## Quick start

```bash
npm ci
cp .env.example .env   # add your own keys; never commit .env
npm run dev            # http://localhost:3000
```

Open `/` (the product page), `/phone`, `/console/today` and `/stage` side by side, reset the demo from the console, and run the daily check.

```bash
npm run typecheck && npm run lint && npm test   # the gate
npm run hammer                                  # hostile presses against the lock
```

## The team

Four people at Hack Western 13, each running an AI coding agent that owns one part of the code (voice and agent, platform and pharmacist, red team, the lock), plus helper agents that review, merge and police the rules. How that works is [below](#how-our-agent-system-works). Brand and design system: [`docs/BRAND.md`](docs/BRAND.md). All docs: [`docs/README.md`](docs/README.md).

## Prize tracks

Overall · Best Health Hack by Sun Life · Best Use of Auth0 · Best Use of Vultr · GoDaddy domain · Best Use of Tiger Data · Best Use of Gemini · Best Use of Entire.

---

## For the team

**Start here:** [`docs/STATUS.md`](docs/STATUS.md) has the role sign-up table and the next steps. Then [`docs/TASKS.md`](docs/TASKS.md) for your role's tasks. Full plan: [`docs/SPEC.md`](docs/SPEC.md). How the parts fit: [`docs/DESIGN.md`](docs/DESIGN.md). For product behaviour, the spec wins. For roles, ownership and how we work, this README and `docs/DESIGN.md` win.

## Progress

*Last updated Sat 6:31 PM EST from `main` and the channel. Each role's agent keeps **only its own row** current: update it whenever you post a HANDOFF, and the integrator updates a row's "Merged" column when it posts MERGED. Counts come from the channel, `main` and `results/`, never from guesses.*

**Core demo: done.** Three clean passes in a row (15, 16 and 17) on `main` 13474ca, Sat 4:05 to 4:28 PM EST, logged in [`docs/DEMO.md`](docs/DEMO.md) with the final walkthrough in `results/demo/2026-11-21T1625-final/`. The gate on `main`: 823 tests pass (1 expected fail, 7 skipped), and the last hammer run reports 0 rules broken across 77,648 hostile press sequences.

| Role | Core done | Merged to `main` | Built, in review | Working on now | Next |
|---|---|---|---|---|---|
| **1 · Voice and agent** | **5.5 of 6 built** (all 6 merged; 1.5 part 2 merged, 1.6's real median needs a live run) | 1.1 prompt and fixed lines, 1.2 typed agent loop plus 1.2b the Agent SDK model, 1.3 outbound call and side effects, 1.4 phone page, 1.5 part 1 voice without keys, 1.6 timing marks, 1.8 interrupt and silence (after core), the phone Answer crash fix (Trail #37) | 1.5 part 2 merged: ElevenLabs voice through the call's speak route (Trails #47, #51); Trail #49's `Voice`-type version is on main too, unwired | Live run with the ElevenLabs key | 1.6's real median and 1.7 model-card measurements, both once a live run is possible |
| **2 · Platform and pharmacist** | **~83%** (5 of 6) | 2.1-2.5, 2.7 Postgres store live on Tiger Data, 2.8 Quick check, security fixes (Trails #3, #10, #12, #19), phone routes and pairing, hijack API, polling fallback, LIVE_AGENT switch, Vultr + Caddy deploy kit | – (2.9 dashboards Upcoming, Trail #44, and Calls, Trail #50, and the speech route, Trail #47, are merged) | Hosting | 2.6: run hosting/README.md once the Vultr and GoDaddy codes are in |
| **3 · Red team and evals** | **4 of 5**, plus the console tabs | 3.1 first 10 scenarios, 3.2 hijack agent, 3.3 scenario runner, 3.4 hijack batch (batch ids fixed, Trail #14), 3.8 console tabs: Review calls and Overnight safety (Trail #46) and Rules, the two-refill regression test, 3.5's parallel suite runner (PR #69). 32 scenario files are in `scenarios/` | – | – | 3.5: run the suite and save a scoreboard (none in `results/` yet) |
| **4 · The lock and integrator** | **6 of 6** | Task 0 contract, 4.2 store and seed, 4.3 control layer, 4.4 speech guard, 4.5 hammers (0 rules broken), 4.6 stage view plus the hijack screen on `/stage`, 4.7 Sam's call end to end, the fail-closed lock (Trail #32), side effects to Review (Trail #25), every S4 fix from the demo passes (Trail #27), 4.9 token measurement (`results/tokens-latest.json`, Trail #59), 4.10 `entire why` export for every rule (`results/why/`, Trail #63) | – | Gating and merging handoffs | – |
| **Design** (helper agent) | Done | Aegis brand, logo and icons, the UI kit in `components/ui/`, the landing page, restyled `/stage`, `/phone` and `/console/today`, the six-tab console nav, the README hero (Trail #34) | – | – | – |

**Review:** the code reviewer posts findings on each Trail and holds merges until they're fixed. `scripts/channel.sh trail-inbox <role>` lists the ones still open for a role.

---

## Who does what

**Nobody is pre-assigned: pick a role.** The shared contract (types and fakes) is set up for everyone first, as task 0, so no role is stuck doing it.

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
   Owner merges once the release gate is green (the lock also needs 0 rules broken) ──▶ main
        ▲
   Rules police checks every agent against docs/RULES.md and reports violations
```

**One task, start to finish**
1. **Claim:** an agent picks its next task from [`docs/TASKS.md`](docs/TASKS.md), opens an **Entire Trail** for it, and posts a CLAIM on the agent channel.
2. **Context:** before editing, it asks **Entire Brain** for the team's decisions and rules, and **Entire Graph** for where the code is and what depends on it.
3. **Build:** it works only in its own folders, on a `role-<n>/<task>` branch. Every commit is linked to the AI session that wrote it (**Entire Sessions**, an `Entire-Checkpoint` trailer), and tests and code go in separate commits.
4. **Hand off:** typecheck, lint, tests (plus the hammers for the lock), then a HANDOFF naming the Trail.
5. **Review:** the **code reviewer** agent posts every problem as a finding on the Trail and sends it back. The owning role fixes it before any new work. The **review fixer** attaches ready-made patches.
6. **Merge:** the owner merges it to `main` once the release gate passes on the merged result, and the reviewer reviews after. Lock changes (the control layer, speech guard and contract) also need the hammers to report 0 rules broken. Merges are automatic: we chose speed for the hackathon.

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

### What we learned, and what we'd change next

This is a prototype of a software process run by AI agents, built in one weekend. The honest version:

- **Rules written as prompts don't hold on their own.** One agent pushed changes to the lock straight to `main` 9 times while a rule said not to. The rules police caught it after the fact. It's the same lesson as our product: *the AI can be fooled, so the rules have to live in code.* **Next:** a `CODEOWNERS` file for `lib/contract/`, `lib/control/` and `lib/guard/`, plus branch protection that requires the release gate and a person's approval, so GitHub itself rejects a lock change nobody approved.
- **Agents don't have their own identity yet.** They push and post through their human's GitHub account, so "only people post HUMAN messages" is enforced by our tooling, not by GitHub. **Next:** a GitHub App per agent, with its own permissions.
- **The agent channel is GitHub issue comments with a fixed header format.** That's simple and readable for a hackathon, but it polls and has no schema. **Next:** merges through pull requests and GitHub Actions, and the channel only for coordination.
- **AI reviews AI.** The code reviewer is the same kind of model as the authors, so they can share blind spots. For the hackathon we chose speed: lock changes merge on the reviewer's approval plus the hammers. **Next:** a person's approval for the lock, enforced by GitHub.
- **We measure before we claim.** Token use per merged task and Graph's savings come from `entire session tokens` and `entire tokens profile` runs saved in `results/`, never estimates.


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
