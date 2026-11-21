# Refill Guard: design

How the system is split into parts, who owns each part, and exactly where the parts meet. `docs/SPEC.md` says *what* to build. This file says *how the pieces fit*, so four people and their AI tools can build in parallel without breaking each other.

If this file and the spec disagree on behaviour, the spec wins. If they disagree on boundaries or interfaces, this file wins, and the spec gets fixed.

---

## 1. The idea in one picture

```
 Patient phone ──speech──▶ Agent loop (Claude) ──button press──▶ CONTROL LAYER ──▶ Store (record, patients, refills)
      ▲                         │                                   │   ▲
      │                     each sentence                           │   │ approvals
      │                         ▼                                   │   │
      └──── ElevenLabs ◀── SPEECH GUARD (S1–S4) ◀───────────────────┘   │
                                                                         │
 Stage view / Pharmacy console ◀── event stream ◀── everything above    │
 Pharmacist phone (Auth0) ───────────────────────────────────────────────┘

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
| Contract (shared types) | `lib/contract/` | Claude, changes need team agreement | Types only |
| Control layer: buttons, rules, cards, engine, triage | `lib/control/` | Claude | Pure code, no AI, no network |
| Speech guard (S1 to S4) and safety keyword check | `lib/guard/` | Claude | Pure code. Person 1 adds the optional Haiku checks behind the same function. |
| Store | `lib/store/` | Claude writes the in-memory version, Person 2 writes the Postgres version | Pure code |
| Seed data | `lib/seed/` | Claude | Data |
| Agent loop, prompt, outbound call, side-effect question | `lib/agent/` | Person 1 | Uses Claude |
| Voice in and out, turn timing | `app/(phone)/`, `lib/voice/` | Person 1 | Chrome speech, ElevenLabs |
| App shell, API routes, event stream, clock and reset | `app/api/`, `lib/events/` | Person 2 | Plain code |
| Auth0: sign-in, roles, phone approvals | `lib/auth/` | Person 2 | Auth0 |
| Hosting, https, domain | infrastructure | Person 2 | |
| Hijack agent (scripted, fully fooled) | `lib/agent/hijack.ts` | Person 3 | Pure code |
| Scenarios, runner, scoring | `lib/arena/`, `scenarios/` | Person 3 | Runner is code, callers use AI |
| Attacker, judge, planner, fix loop | `lib/arena/` | Person 3 | Gemini, Claude, Fable 5.2 |
| Hammers and release gate | `scripts/` | Claude | Pure code |
| Phone view, stage view, gate animation | `app/(phone)/`, `app/stage/` | Person 4 | UI |
| Pharmacy console | `app/console/` | Person 4 | UI |
| Pitch, Devpost, video | `docs/pitch/` | Person 4, whole team rehearses | |

---

## 3. The interfaces (where people's work meets)

Every interface below lives in `lib/contract/` as TypeScript types. **Build against the types, not against someone's implementation.** Until a real implementation exists, use the fake that the contract file exports.

### 3.1 Buttons (agent → control layer)

```ts
press(callId: CallId, button: ButtonName, input: unknown): Promise<ButtonResult>
// ButtonResult = { ok: true, output } | { ok: false, error, ruleIds }
// Never throws to the agent. Every press writes a record entry.
```

- Used by: the agent loop (Person 1), the hijack agent and scenario runner (Person 3), the hammers (Claude).
- The 12 button names and their input and output shapes are in `lib/contract/buttons.ts`, matching SPEC Part 3.

### 3.2 Speech guard (agent → guard → voice)

```ts
guardSentence(callId: CallId, sentence: string): GuardResult
// GuardResult = { speak: string, blocked: false } | { speak: replacement, blocked: true, rule: "S1"|"S2"|"S3"|"S4" }
```

- Person 1 splits the model's streamed text into sentences and calls this **once per sentence, before speech**. Only `speak` goes to ElevenLabs.
- The guard reads the call's state and record from the store, which is how S4 knows what's been approved.

### 3.3 Safety check (caller line → agent)

```ts
checkCallerLine(callId: CallId, line: string): SafetyResult
// SafetyResult = { action: "continue" } | { action: "emergency" | "crisis" | "handover", script: string }
```

- Person 1 calls it on every caller line before the model sees it. The keyword part is Claude's. The optional Haiku check is Person 1's, behind the same function.

### 3.4 Agent driver (anything that runs a call)

```ts
interface AgentDriver {
  startCall(opts: { direction: "inbound" | "outbound", patientId?: PatientId }): Promise<CallId>
  callerSays(callId: CallId, text: string): AsyncIterable<AgentEvent>   // agent lines, presses, blocks
  endCall(callId: CallId): Promise<void>
}
```

- Two implementations: the real Claude agent (Person 1) and the scripted hijack agent (Person 3).
- The scenario runner, the attacker and the phone page all talk to `AgentDriver`, so they work with either agent.

### 3.5 Store (everyone → data)

```ts
interface Store {
  getPatient, getPrescriptions, getCall, saveCall,
  appendRecord(entry: RecordEntryInput): RecordEntry   // adds the hash chain
  listRecord(callId?): RecordEntry[]
  queue(lane?: Lane): QueueItem[]
  decide(itemId, decision: "approve" | "deny", approver: Approver, note?: string): QueueItem
  reset(seed: Seed): void
}
```

- **Claude ships the in-memory store first**, so nothing waits on the database. Person 2 adds the Postgres version behind the same interface later. Swapping is one line.

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

- Person 2 runs the stream at `/api/events`. Everyone emits through `emit(event)`. Person 4's pages only listen.
- The gate animation is driven purely by `press` and `blocked_line` events.

### 3.7 Approvals (console or phone → store)

```ts
POST /api/queue/:id/decide   { decision, note? }   // Auth0 session required, role "pharmacist"
```

- Person 2 checks the Auth0 session and role, then calls `store.decide`, with the approver taken from the token.
- When Auth0's phone approval works, the phone path calls the same `store.decide`. When it doesn't, the console button is the fallback. Same record either way.

### 3.8 Scenarios (Person 3 → runner)

- One JSON file per scenario in `scenarios/`, using the format in SPEC Part 4. The runner replays caller lines through `AgentDriver` and scores **only from the record**.

---

## 4. Critical path

```
contract ──▶ control layer + in-memory store ──▶ typed agent loop ──▶ queue + approve API ──▶ console Today
   │                    │                                   │
   │                    └──▶ hijack agent ──▶ hijack demo   └──▶ voice ──▶ outbound call
   └──▶ (fakes let everyone start now)
```

- **Nobody waits:** the contract exports fakes, so Persons 1, 3 and 4 can start before the control layer is finished.
- **The noon checkpoint** (a typed refill working three times in a row) needs the contract, control layer, store, agent loop and the approve endpoint.
- **Postgres, Auth0's phone approval, voice and hosting** are off the critical path. Each has a fallback: the in-memory store, the console button, typed input, and a tunnel.

---

## 5. Role audit

Checked against the spec, the critical path and the demo. These are the problems found, and the fixes now in the README.

| # | Problem | Fix |
|---|---|---|
| 1 | **The hijack switch had no owner** in the README, even though it's the demo's best moment | Person 3 owns the scripted hijack agent and the attack cards' behaviour. Person 4 owns how the cards look. |
| 2 | **Person 3 had nothing on the critical path early**, since the attacker and overnight run come after the core | Person 3's first job is now the hijack agent and the scenario runner, both core. The attacker comes after. |
| 3 | **Person 1 was overloaded:** voice, agent, outbound, side effects, guard wiring and timing | The guard and safety checks are now Claude's code behind two functions, so Person 1 only calls them. The outbound trigger (daily check) moves to Person 2's clock. |
| 4 | **Person 2's Auth0 phone approval is the riskiest unknown** and sat in the middle of the plan | It's moved off the critical path behind the approve endpoint. The console button is the default, and the phone path replaces it when it works. Check the free plan by Saturday 10 AM. |
| 5 | **Everyone needed the database before they could start** | Claude ships an in-memory store first. Postgres comes later behind the same interface. |
| 6 | **The event stream had no agreed shape,** so the stage view would have broken whenever someone added an event | The event types are in the contract (3.6), and nobody adds a type without updating it. |
| 7 | **Post-core items were unowned:** cited briefs, rule writer, Review calls lab | Cited briefs and the Review calls lab go to Person 3 (both use AI judging). The rule writer is Claude's engine plus Person 4's UI. All are after the core. |
| 8 | **Nobody owned rehearsal and the pitch on the day** beyond Person 4 | Person 4 runs rehearsals. Everyone presents their part. The friend opens, and the presenter is decided by Saturday 6 PM. |
| 9 | **Two people could edit the same files** (agent loop and hijack, console and API) | Each folder in section 2 has exactly one owner. Cross-folder changes go through a request (see `AGENTS.md`). |

**Load after the fixes (core hours):** Person 1, agent loop and voice. Person 2, app shell, API, events, Auth0, hosting. Person 3, hijack agent, scenario runner, first scenarios. Person 4, phone, stage, gate, console Today. Claude, contract, control layer, guard, store, seed, hammers. Every person has one critical-path item, and no one has two.

---

## 6. Design decisions

| Decision | Why |
|---|---|
| The lock is plain code, not AI | It has to give the same answer every time, and be testable with millions of hostile inputs |
| One `AgentDriver` interface for real, hijacked and scenario calls | "Everything is a call." The hijack proof only means something if it uses the same path as real calls. |
| In-memory store first, Postgres second | Nobody blocks on infrastructure. Behaviour is identical. |
| Events are the only way pages learn anything | Pages stay simple, and the stage view and console can't disagree |
| Triage lanes are chosen in code from rules and signals | The pharmacist's attention depends on facts, not the AI's opinion |
| The AI's self-reported confidence is shown but never used | Models are often overconfident |
| Keys only on the server | The repo may go public, and the phones run untrusted browsers |

---

## 7. How the AI coding agents coordinate

See `AGENTS.md`. In short, **the repo is the shared channel**:
- `AGENTS.md`: rules every AI tool reads first
- `lib/contract/`: the shapes everyone builds against
- `docs/STATUS.md`: what each person is doing, has done, and needs
- `docs/DECISIONS.md`: decisions, so nobody's agent undoes them
- GitHub issues for requests between people

Humans talk in the team chat. Agents talk through those files.
