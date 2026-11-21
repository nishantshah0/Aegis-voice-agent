# Refill Guard

**Hack Western 13 · submissions close Sunday, November 22, 9:00 AM Eastern**

An AI phone line for pharmacies. It calls patients before their medication runs out and handles their refills. A pharmacist approves only the tricky calls, from their console. Every action and word the AI tries goes through rules in code, so even a fooled AI can't break them, and an AI attacker tests it every night.

**The line judges should repeat:** *The AI can be fooled. The pharmacy can't.*

Full plan: [`docs/SPEC.md`](docs/SPEC.md). How the parts fit: [`docs/DESIGN.md`](docs/DESIGN.md). If this README and the spec disagree, the spec wins.

---

## Who does what

| Person | Owns | First task (before sleep) | Done when |
|---|---|---|---|
| **1 · Voice and agent** | The agent loop on Claude, the prompt, the outbound call, the side-effect question, voice in (Chrome) and out (ElevenLabs), turn timing. Calls the guard and safety check, doesn't write them. | A typed agent loop that presses the 12 buttons through the contract's fake | Sam's Concerta refill works typed, start to finish, three times in a row |
| **2 · Platform** | App shell and API routes, the event stream, the demo clock, reset and daily reminder check, the approve endpoint, Auth0 (sign-in, roles, phone approvals), the Postgres store, hosting on Vultr with https, the domain | App deployed over https with Auth0 sign-in, and check whether Auth0's phone approval works on the free plan | Both phones open the app over https and use the microphone, and a pharmacist approval lands in the record |
| **3 · Red team and evals** | **The scripted hijack agent**, the scenario runner and scoring, the 28 scenarios. After the core: the Gemini attacker, the Fable planner, the judge, the overnight run, the fix loop, cited briefs, the Review calls lab. | The hijack agent and the scenario file format, with the first 10 scenarios | The hijack demo blocks every attack card, and all 28 scenarios run and score |
| **4 · Design and pitch** | The phone view, the stage view with the gate animation, the pharmacy console (Today first), the rule writer's screen later, Devpost, the video, rehearsals, the Sun Life visit | Phone, stage and console Today, driven by fake events | The demo runs twice in a row with no extra clicks, and looks finished |
| **Claude** (on Nishant's laptop) | The contract (shared types and fakes), the control layer, rule cards and engine, triage lanes, the speech guard (S1 to S4) and safety keywords, the in-memory store, seed data, both hammers, the release gate | The contract with fakes, so everyone can start now | The hammers report 0 rules broken, and every rule has tests |

**Everyone's AI tool reads [`AGENTS.md`](AGENTS.md) first.** Who owns which folder, and how the pieces connect, is in [`docs/DESIGN.md`](docs/DESIGN.md). Progress and requests go in [`docs/STATUS.md`](docs/STATUS.md). Decisions go in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**The contract (`lib/contract/`) is shared.** Don't change it directly. Propose changes in `docs/STATUS.md`.

---

## Timeline

| When | Goal | Checkpoint |
|---|---|---|
| Sat now to ~5 AM | Interface file, app skeleton, seed data, core rules, stage layout | The hammers report 0 |
| Sat ~5 to 9 AM | Sleep in shifts. Person 1 keeps the agent loop moving. | |
| Sat 9 AM to noon | Typed refill end to end. Visit the Sun Life table. | **A typed refill works three times in a row** |
| Sat noon to 4 PM | Speech guard, safety checks, outbound call, side effects, triage, first arena run | First real numbers. **Record a backup video.** |
| Sat 4 to 8 PM | Voice, Auth0 approvals, hijack switch, console | A spoken outbound refill works three times in a row |
| Sat 8 PM to midnight | Only once the core works twice: scenarios and scoreboard, then the attacker and overnight run | The core demo runs twice in a row |
| Sun midnight to 6 AM | Overnight run, final numbers, polish | Final numbers saved |
| Sun 6 to 8:30 AM | No new features. Video, Devpost, five rehearsals. | **Submitted by 8:30 AM** |

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
| Sign-in and approvals | Auth0 (including Auth0 for AI Agents approvals on the pharmacist's phone) |
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
4. **Build against the interface file.** Give your AI tool `docs/SPEC.md` and `lib/control/contract.ts` at the start of every session.
5. **One person per area. Commit often, pull often.**
6. **Keys never go in code.** Use `.env`, which is in `.gitignore`. Check before every push, because this repo may go public later.
7. **Made-up patients only.** Phone numbers use 555-01xx.
8. **Only real numbers in the pitch.** If a number didn't come from a real run, it doesn't go on a slide or in Devpost.

## Open questions

- Our teammate's OK to share his story in the pitch, and in what words
- How many prize tracks one project can enter
- Whether Auth0 phone approvals work on the free plan (check by Saturday 10 AM)
- How judging works: tables or a stage, and how long per team (we've planned 3 minutes plus 2 of questions)
