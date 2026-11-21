# Tasks

Four people, all coding. Each role's tasks are in order. Do the **core** tasks first. **After core** tasks wait until the core demo works twice in a row.

The pitch, video and Devpost are done **together at the end** (Sunday 6 to 8:30 AM), not by one role.

**Pick a role** in the sign-up table in `docs/STATUS.md`, then give your agent its loop prompt (`agents/role-<n>.md`).

Open a Trail for each task when you start it (`entire trail create --title "..."` on a branch named `<role>/<task>`), or a GitHub "Claim a task" issue if you're not on Entire yet.

---

## Task 0: setup, before roles start

The **contract** (`lib/contract/`): shared types for the 12 buttons, the guard, the safety check, `AgentDriver`, `Store`, events, the record, rule cards and lanes, plus **fakes** with Sam's data so every role can build against them right away. It's generated once as setup (Trail #1) and isn't any role's job. Changes after that go through a contract-change issue.

## Nobody waits

| Role | Start right now with |
|---|---|
| 1 | Task 1.1, the prompt and fixed lines |
| 2 | Task 2.1, the API skeleton and event stream |
| 3 | Task 3.1, the scenario format and first scenarios |
| 4 | Task 4.2, the in-memory store and seed data, as soon as task 0 lands |

---

## Role 1 · Voice and agent

| # | Task | Done when | Needs |
|---|---|---|---|
| **Core** | | | |
| 1.1 | **Prompt and fixed lines:** the system prompt, plus the scripted lines (inbound greeting, outbound opener, "If those details match, I've sent a code", "One moment", the side-effect question built from label text) | Lines reviewed against SPEC Part 2, prompt has no list of forbidden things | Nothing |
| 1.2 | **Typed agent loop:** Claude with the 12 buttons as tools (strict schemas, automatic tool choice), streamed replies split into sentences, each sentence through `guardSentence`, each caller line through `checkCallerLine` first, implementing `AgentDriver` | Sam's typed call works end to end against the fakes | Task 0 |
| 1.3 | **Outbound call and side effects:** the outbound flow (opener, code, date of birth), the side-effect question after a refill, mild answers turned into a pharmacist note | Sam's outbound call ends in the Review lane with his side-effect note | 1.2 |
| 1.4 | **Phone page** (`app/phone`): ring, Answer, code text, transcript, typed box, status ("Approved, ready Thursday"), driven by events | The judge can do Sam's whole call on a phone, typed | 1.2, 2.2 |
| 1.5 | **Voice:** Chrome speech in (finalise after about 600 ms of silence, microphone off while the agent speaks, hold-to-talk switch), ElevenLabs Flash out, pre-recorded fixed lines, numbers rewritten as words | Sam's call works by voice three times in a row on a real phone | 1.4, 2.6 |
| 1.6 | **Turn timing:** log caller-stopped, first model text, first sentence through the guard, speech started | Median time per turn shown, under 1.2 s, or we know what to change | 1.5 |
| **After core** | | | |
| 1.7 | Measure candidate agent models (speed, cost, behaviour) for the model card | Table filled from real runs | 3.5 |
| 1.8 | Tap to interrupt, silence handling ("Are you still there?") | Works in a test call | 1.5 |

## Role 2 · Platform and pharmacist

| # | Task | Done when | Needs |
|---|---|---|---|
| **Core** | | | |
| 2.1 | **API skeleton and event stream:** `/api/call/start`, `/api/call/:id/say`, `/api/events` (server-sent events), `/api/queue/:id/decide`, `/api/clock`, `/api/demo/reset`, and an `emit()` everyone calls | A test event shows up live in a browser tab | Nothing, then switch to the contract types when 4.1 lands |
| 2.2 | **Demo clock, reset and daily reminder check:** reset reseeds and sets Tuesday 10 AM. The daily check starts Sam's outbound call. | Reset then "run daily check" rings Sam's phone | 2.1, 4.2 |
| 2.3 | **Console Today view** (`app/console/today`): lane totals, Review lane first, an item's detail (rule that sent it, side effect, promises checked, signals, transcript, the AI's own view labelled), Approve and Deny | Sam's refill shows in Review with everything, and Approve updates his phone | 2.1, Task 0 |
| 2.4 | **Auth0 sign-in and roles:** `pharmacist` and `reviewer`. The approve endpoint takes the approver from the token. | Only a signed-in pharmacist can approve, and their name lands in the record | 2.1 |
| 2.5 | **Check Auth0's phone approval on the free plan** (by Saturday 10 AM). If it works, wire it to the same approve path. | The pharmacist's phone buzzes and approves, or we've confirmed the console button is the path | 2.4 |
| 2.6 | **Hosting:** Vultr server, automatic https, domain. Both phones can open it and use the microphone. | A phone on the hall's network uses its microphone on our https address | 2.1 |
| **After core** | | | |
| 2.7 | Postgres store on Tiger Data, behind the same `Store` interface | Swapping stores changes one line, and every test passes on both | 4.2 |
| 2.8 | Quick check lane: one-tap approvals, each signed | Six quick-check items approved, each in the record | 2.4 |

## Role 3 · Red team and evals

| # | Task | Done when | Needs |
|---|---|---|---|
| **Core** | | | |
| 3.1 | **Scenario format and first 10 scenarios** (JSON in `scenarios/`): Sam's ordinary call, a controlled drug asked early, someone else's prescription, a new address, a pre-verification leak, a dose not on the label, a false promise, a side effect, an emergency, "a person please" | 10 files, each with expected outcomes from SPEC Part 4 | Nothing |
| 3.2 | **Hijack agent** (`lib/agent/hijack.ts`): an `AgentDriver` that presses whatever buttons and says whatever lines the attacker asks for. The four attack cards' scripts. | Each attack card produces its attempts through the real control layer | Task 0 |
| 3.3 | **Scenario runner and scoring:** replay caller lines through any `AgentDriver`, score only from the record, emit `caught` and `broken` | The 10 scenarios run against the fakes and score | 3.1, Task 0 |
| 3.4 | **Hijack batch:** run the attack scenarios through the hijack agent for the demo's 10-second batch | "Caught" climbs and "broken" stays 0 on the stage view | 3.2, 3.3, 4.3 |
| 3.5 | **All 28 scenarios**, each run 3 times, counting only those that pass all 3 | Scoreboard numbers from a real run saved in `results/` | 3.3 |
| **After core** | | | |
| 3.6 | Gemini attacker and Fable 5.2 planner, failures saved as permanent scenarios | At least one real gap found and saved | 3.5 |
| 3.7 | **Overnight run on Entire Trails:** spend cap; every gap the attacker finds becomes a Trail with the failing scenario and a proposed fix, checked by `entire review` and the release gate, approved by a person on Entire, then merged | One real gap found, fixed on a Trail, approved by a person and live | 3.6, 4.7 |
| 3.8 | Console tabs: Review calls (hand labelling), Rules and checks (with an **`entire why` panel per rule**, read from `results/why/`), Overnight safety (with links to each fix's Trail) | Each shows real data | 3.5, 4.10 |
| 3.9 | Cited briefs for the pharmacist | No uncited sentence reaches the console in 20 calls | 2.3 |

## Role 4 · The lock

| # | Task | Done when | Needs |
|---|---|---|---|
| **Core** | | | |
| 4.2 | **In-memory store and seed data:** the 8 made-up patients from SPEC Part 5, Sam pinned (refill 1 of 2, filled 27 days ago) | `reset()` gives the same state every time | Task 0 |
| 4.3 | **Control layer:** the 12 buttons, core rules 1 and 5, rule cards (2, 3, 4, 4b, 6, 7, 8, 11) with the strictest-wins engine, triage lanes, the hash-chained record | Unit tests for every button, rule and lane | 4.2 |
| 4.4 | **Speech guard S1 to S4 and safety keywords** | Each rule has a line that's blocked and a line that passes | 4.2 |
| 4.5 | **Hammers:** exhaustive (up to 4 presses) and random. `npm run hammer` in the release gate. | 0 rules broken, with the real count printed | 4.3, 4.4 |
| 4.6 | **Stage view and gate animation** (`app/stage`), driven only by events | A hijack batch runs smoothly on a projector | 2.1, 3.4 |
| 4.7 | **Integration:** review and merge Trails in dependency order, keep `main` green | The core demo runs twice in a row from `main` | everything above |
| **After core** | | | |
| 4.8 | Rule writer engine (plain English to a rule card, tests, impact preview) | The antibiotic rule goes live after approval | 4.3 |
| 4.9 | **Entire token measurement:** `entire tokens profile --all` on Saturday evening and Sunday morning, plus three tasks with and without Graph compared with `entire session tokens` | Real numbers in `results/entire-tokens.md` | Nothing |
| 4.10 | **`entire why` export:** a script that saves `entire why --json` for every rule file and card to `results/why/`, rerun before the demo | Every rule in the console shows its prompt, session and approval | 4.3 |
| 4.11 | **Morning dispatch:** run `entire dispatch` after the overnight run and post it to the agent channel | The dispatch is on the channel, and in the Devpost screenshots | 3.7 |

---

## Together, at the end

| When | What |
|---|---|
| Saturday afternoon, as soon as anything works | Record a backup video of the typed call |
| Sunday 6 to 8:30 AM | No new features. Pitch, demo rehearsals (five, with a stopwatch), final video, Devpost. Everyone. |
