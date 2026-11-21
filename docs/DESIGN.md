# Aegis (formerly Refill Guard): design

How the parts fit and who owns them. This is the design target; [CURRENT.md](CURRENT.md) shows what is merged and includes a diagram of the running path. `docs/SPEC.md` says what to build.

If this file and the spec disagree on behaviour, the spec wins. If they disagree on boundaries or interfaces, this file wins, and the spec gets fixed.

---

## 1. Planned call path

```
 Patient phone ──speech──▶ Agent loop (Claude) ──button press──▶ CONTROL LAYER ──▶ Store (record, patients, refills)
      ▲                         │                                   │   ▲
      │                     each sentence                           │   │ approvals
      │                         ▼                                   │   │
      └──── ElevenLabs ◀── SPEECH GUARD (S1–S4) ◀───────────────────┘   │
                                                                         │
 Stage view / Pharmacy console ◀── event stream ◀── everything above    │
 Pharmacist console (Auth0 sign-in) ─────────────────────────────────────┘

 Hijack switch, scenarios, attacker ──▶ same agent loop interface ──▶ same control layer
```

Three things never change, whoever is coding:

1. **The AI can only act through the 12 buttons**, and every press goes through the control layer.
2. **The AI can only speak through the speech guard.** No text reaches speech without passing it.
3. **Everything is a call.** Patient calls, scenarios and attacks use the same agent interface, the same rules and the same record. There's no separate testing path.

---

## 2. The parts

| Part | Folder | Owner | Pure code or uses AI? |
|---|---|---|---|
| Contract (shared types and fakes) | `lib/contract/` | Role 4 merges reviewed changes and announces them with a DECISION. A contract-change issue is optional. | Types and fakes |
| Control layer: buttons, rules, cards, engine, triage | `lib/control/` | Role 4 | Pure code, no AI, no network |
| Speech guard (S1 to S4) and safety keyword check | `lib/guard/` | Role 4 | Pure code. Role 1 adds the optional Haiku checks behind the same function. |
| Store | `lib/store/` | Role 4 writes the in-memory version, Role 2 the Postgres version | Pure code |
| Seed data | `lib/seed/` | Role 4 | Data |
| Agent loop, prompt, outbound call, side-effect question | `lib/agent/` | Role 1 | Uses Claude |
| Voice in and out, turn timing, the patient phone page | `app/phone/`, `lib/voice/` | Role 1 | Chrome speech, ElevenLabs |
| App shell, API routes, event stream, clock and reset | `app/api/`, `lib/events/` | Role 2 | Plain code |
| Auth0: sign-in and roles | `lib/auth/` | Role 2 | Auth0 |
| Hosting, https, domain | infrastructure | Role 2 | |
| Hijack agent (scripted, fully fooled) | `lib/agent/hijack.ts` | Role 3 | Pure code |
| Scenarios, runner, scoring | `lib/arena/`, `scenarios/` | Role 3 | Runner is code, callers use AI |
| Attacker, judge, planner, fix loop | `lib/arena/` | Role 3 | Gemini, Claude, Fable 5.2 |
| Hammers and release gate | `scripts/`, `.github/workflows/` | Role 4 | Pure code |
| Stage view and gate animation | `app/stage/` | Role 4 | UI driven by events |
| Pharmacy console: Today view and approvals | `app/console/today/` | Role 2 | UI |
| Pharmacy console: Review calls, Rules and checks, Overnight safety | `app/console/{review,rules,overnight}/` | Role 3 | UI |
| Pitch, video and Devpost | `docs/pitch/` | Everyone, together, Sunday morning | |

---

## 3. The interfaces (where people's work meets)

Every interface below lives in `lib/contract/` as TypeScript types. **Build against the types, not against someone's implementation.** Until a real implementation exists, use the fake that the contract file exports.

### 3.1 Buttons (agent → control layer)

```ts
press(callId: CallId, button: ButtonName, input: unknown): Promise<ButtonResult>
// ButtonResult = { ok: true, output } | { ok: false, error, ruleIds }
// Never throws to the agent. Every press writes a record entry.
```

- Used by: the agent loop (Role 1), the hijack agent and scenario runner (Role 3), the hammers (Role 4).
- The 12 button names and their input and output shapes are in `lib/contract/buttons.ts`, matching SPEC Part 3.
- Built by `createControl({ store, emit })` in `lib/control`, which also gives `startInboundCall()`, `startOutboundCall(patientId, rxId)` (the only way to ring a patient, rule 7), `checkOutbound` and `codeFor(callId)`. A button's record entry stores `output: { result, internal }`; score from `output.result`.
- **Current gap:** the API runtime uses the control layer's default `broadcastCodes: true`, so code digits appear in the unauthenticated event stream. Role 2's audience-filtering change is under review. Do not rely on this planned privacy boundary until it merges; see [CURRENT.md](CURRENT.md).

### 3.2 Speech guard (agent → guard → voice)

```ts
guardSentence(callId: CallId, sentence: string): Promise<GuardResult>
// GuardResult = { speak: string, blocked: false } | { speak: replacement, blocked: true, rule: "S1"|"S2"|"S3"|"S4" }
```

- Role 1 splits the model's streamed text into sentences and calls this **once per sentence, before speech**. Only `speak` goes to ElevenLabs.
- The guard reads the call's state and record from the store, which is how S4 knows what's been approved. It writes every sentence to the record (`line_spoken` or `line_blocked`). Built by `createSpeechGuard({ store, emit })` in `lib/guard`.

### 3.3 Safety check (caller line → agent)

```ts
checkCallerLine(callId: CallId, line: string): Promise<SafetyResult>
// SafetyResult = { action: "continue" } | { action: "emergency" | "crisis" | "handover", script: string }
```

- Role 1 calls it on every caller line before the model sees it. It records the line (`caller_line`), which is how S1 and S2 know what the caller has said. The keyword part is `createSafetyCheck({ store, emit })` in `lib/guard`. The optional Haiku check is Role 1's, behind the same function.

### 3.4 Agent driver (anything that runs a call)

```ts
interface AgentDriver {
  startCall(opts: { direction: "inbound" | "outbound", patientId?: PatientId }): Promise<CallId>
  callerSays(callId: CallId, text: string): AsyncIterable<AgentEvent>   // agent lines, presses, blocks
  endCall(callId: CallId): Promise<void>
}
```

- The real Claude driver and scripted hijack driver exist. The API runtime still uses the contract's fake driver for caller turns. The scenario and hijack libraries use `AgentDriver`; the phone page and adaptive attacker are planned.

### 3.5 Store (everyone → data)

```ts
interface Store {   // every method is async, so Postgres is a one-line swap
  now, setNow, getPatient, listPatients, getPrescriptions, getPrescription,
  listSlots, listOrders, saveOrder, listCards, policy, getCall, saveCall,
  appendRecord(entry: RecordEntryInput): Promise<RecordEntry>   // adds the hash chain
  listRecord(callId?): Promise<RecordEntry[]>
  addQueueItem(item): Promise<QueueItem>
  updateQueueItem(itemId, patch): Promise<QueueItem>
  queue(lane?: Lane): Promise<QueueItem[]>
  decide(itemId, decision: "approve" | "deny", approver: Approver, note?: string): Promise<QueueItem>
  reset(seed: Seed): Promise<void>
}
```

- **The in-memory store (`lib/store/memory.ts`, `getStore()`) ships first**, so nothing waits on the database. The full interface is in `lib/contract/store.ts`. Role 2 adds the Postgres version behind the same interface later. Swapping is one line.

### 3.6 Event stream (server → pages)

```ts
type StreamEvent =
  | { type: "line", callId, who: "agent" | "caller", text }
  | { type: "blocked_line", callId, rule, original, replacement }
  | { type: "press", callId, button, decision: "allowed" | "routed" | "refused" | "flagged", ruleIds, lane? }
  | { type: "phone", callId, kind: "ring" | "code" | "status", text }
  | { type: "queue", item: QueueItem }
  | { type: "score", caught: number, broken: number }
  | { type: "clock", now: string }
```

- Role 2 runs the stream at `/api/events`. Producers emit through `emit(event)`. Stage listens to the stream; Today reads the store on the server and listens for events to refresh. The event bus is separate from the decision record.
- The gate animation is driven purely by `press` and `blocked_line` events.

### 3.7 Approvals (console → store)

```ts
POST /api/queue/:id/decide   { decision, note? }   // Auth0 session required, role "pharmacist"
```

- Role 2 checks the Auth0 session and role, then calls `store.decide`, with the approver taken from the token.
- There is no phone path: approvals are the Approve and Deny buttons on the console's Today page (task 2.5 decision).

### 3.8 Scenarios (Role 3 → runner)

- One JSON file per scenario in `scenarios/`, using the format in SPEC Part 4. The runner replays caller lines through `AgentDriver`. Policy pass/fail uses the decision record; a planned AI judge separately flags unsafe speech with exact quotes.

---

## 4. Critical path

```
contract ──▶ control layer + in-memory store ──▶ typed agent loop ──▶ queue + approve API ──▶ console Today
   │                    │                                   │
   │                    └──▶ hijack agent ──▶ hijack demo   └──▶ voice ──▶ outbound call
   └──▶ (fakes let everyone start now)
```

- The contract exports fakes for isolated work. The control layer and in-memory store are now merged.
- **The noon checkpoint** (a typed refill working three times in a row) needs the contract, control layer, store, agent loop and the approve endpoint.
- **Postgres, voice and hosting** are off the critical path. Each has a fallback: the in-memory store, typed input, and a tunnel.

---

## 5. Role audit

Checked against the spec, the critical path and the demo. These are the problems found, and the fixes now in the README.

| # | Problem | Fix |
|---|---|---|
| 1 | **The hijack switch had no owner** in the README, even though it's the demo's best moment | Role 3 owns the scripted hijack agent and the attack cards' behaviour. Role 4 owns how the cards look. |
| 2 | **Role 3 had nothing on the critical path early**, since the attacker and overnight run come after the core | Role 3's first job is now the hijack agent and the scenario runner, both core. The attacker comes after. |
| 3 | **Role 1 was overloaded:** voice, agent, outbound, side effects, guard wiring and timing | The guard and safety checks are now Claude's code behind two functions, so Role 1 only calls them. The outbound trigger (daily check) moves to Role 2's clock. |
| 4 | **Role 2's Auth0 phone approval is the riskiest unknown** and sat in the middle of the plan | It was moved off the critical path behind the approve endpoint, then dropped: the console button is the approval path (task 2.5). |
| 5 | **Everyone needed the database before they could start** | Role 4 ships an in-memory store first. Postgres comes later behind the same interface. |
| 6 | **The event stream had no agreed shape,** so the stage view would have broken whenever someone added an event | The event types are in the contract (3.6), and nobody adds a type without updating it. |
| 7 | **Post-core items were unowned:** cited briefs, rule writer, Review calls lab | Cited briefs and the Review calls lab go to Role 3 (both use AI judging). The rule writer is Claude's engine plus Role 4's UI. All are after the core. |
| 8 | **Nobody owned the pitch on the day** | The pitch, video and Devpost are done by everyone together on Sunday morning. During the build, every role writes code. |
| 9 | **Two people could edit the same files** (agent loop and hijack, console and API) | Each folder in section 2 has exactly one owner. Cross-folder changes go through a request (see `AGENTS.md`). |

**Load after the fixes (core hours):** Role 1, agent loop, voice and the phone page. Role 2, app shell, API, events, Auth0, hosting and the console's Today view. Role 3, hijack agent, scenario runner and first scenarios. Role 4, control layer, guard, store, seed, hammers and the stage view. Every role has one critical-path item, and no one has two.

**Update:** there's no separate design and pitch role, and all four roles write code. Screens were split by who produces the data behind them: the phone page to Role 1, the console's Today view to Role 2, the other console tabs to Role 3, and the stage view to Role 4. The task list is in `docs/TASKS.md`.

---

## 6. Design decisions

| Decision | Why |
|---|---|
| The lock is plain code, not AI | It has to give the same answer every time, and be testable with millions of hostile inputs |
| One `AgentDriver` interface for real, hijacked and scenario calls | "Everything is a call." The hijack proof only means something if it uses the same path as real calls. |
| In-memory store first, Postgres second | Nobody blocks on infrastructure. Behaviour is identical. |
| Server pages read the store; client views use events to refresh | Today can load current queue state, while Stage shows live events |
| Triage lanes are chosen in code from rules and signals | The pharmacist's attention depends on facts, not the AI's opinion |
| The AI's self-reported confidence is shown but never used | Models are often overconfident |
| Keys only on the server | The repo may go public, and the phones run untrusted browsers |

---

## 7. How the AI coding agents coordinate

**On GitHub, in the open, so it shows on the repo.** See `AGENTS.md` and the README's "How we build".

| Step | Where | What it does |
|---|---|---|
| Claim | Entire Trail and CLAIM on issue #1; a claim issue may record cross-role scope | Role, branch and files, so scopes never overlap |
| Build | One task branch per claim | One owner per folder |
| Contract change | Role 4 branch, Trail, review, hammer gate and DECISION; issue optional | Every role learns about interface changes |
| Handoff | Entire Trail and channel HANDOFF; pull request when requested or using GitHub review | What changed, checks run, and who needs to review |
| Gate | GitHub Actions, "Release gate" | Typecheck, lint, tests, hammers and build on pull requests and pushes to `main` |
| Memory | `docs/STATUS.md`, `docs/DECISIONS.md` | What each role is doing and what's been decided |

**Why GitHub, not Discord:** it's where the code already is, every AI tool can use it through the `gh` command, it needs no bot or server, and anyone who opens the repo sees the whole history of humans and agents working together. Discord or Slack can mirror it later with a webhook, as a nice-to-have.
