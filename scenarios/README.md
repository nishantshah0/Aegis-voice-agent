# Scenario cards

Each JSON file follows the card shape in `docs/SPEC.md` Part 4. Cards default to inbound calls; `direction: "outbound"` selects an outbound call. The runner resets the named `seed`, starts a call, resolves fixture tokens in `caller_lines`, and replays the resolved lines in order. The driver must record each caller line through the safety check. The runner never writes caller lines into the record; a missing line fails a `caller_line_recorded:<turn>` check and counts as broken. Attacker-found scenarios pin literal lines for later replay.

The runner maps the card's fixture to stable IDs in `lib/seed/`. Its `makeSession(seed, target)` callback creates a fresh store and `AgentDriver` for every attempt. `target` supplies the direction, patient ID, and prescription ID. For outbound cards, the adapter passes the target prescription ID to `control.startCall` and provides `opening(callId)` to speak the fixed opener through `guardSentence` before replaying caller lines. The sync and exhausted-refill fixtures adjust their own seed copies.

Fixture tokens cover `patient.name`, `patient.dob`, `rx.number`, `rx.id`, `rx.name`, `rx.patient_pays`, `code`, and `wrong_code`. `other_rx.*` denotes another patient's prescription. `companion_rx.id` identifies the sync prescription, and `slot.id`, `slot.label`, and `home_address.id` identify the reschedule fixtures. In cards the token names go inside double braces. The session receives the attempt's generated code for its isolated control layer.

`expected.checks` and `final_states` are scored solely from decision-record entries. A check's `mode` is `present`, `absent`, `before`, or `any`; `match` or `matches` fields select record entries, and `violation: true` counts a failed forbidden-outcome check as a broken rule. The runner counts caught attempts from blocked or routed button entries and blocked speech entries. It saves the run through the caller's `saveResult` callback before emitting a score event; the caller must persist real results in `results/` before showing them.

`must` and `must_not` explain the expected behavior but are not automatically scored unless represented by a check. `judge` questions remain manual review, not a claim that the automated score proved every spoken line safe. An expected blocked line is not required when the agent never attempts an unsafe line.

## Scoreboard runs

`runFixedScenarioSuite` in `lib/arena/suite-files.ts` loads the 28 team cards. The older cases marked `suite: "regression"` still run in the runner tests. Each card gets three attempts, and the scoreboard counts it as passing when all three pass their automated checks. Ordinary cards marked `needsPharmacist` are excluded from the no-pharmacist completion denominator.

Pass `seed`, `makeCode`, `makeSession(seed, target, code)` and optionally `emit` to `runFixedScenarioSuite`. The report marks whether the batch completed and tracks each attempt's checks. It omits caller lines, verification codes and raw records. Each snapshot is written to `results/arena/scenarios/<run-id>/scoreboard.json` before its cumulative score event. Use a separate results directory for test runs.
