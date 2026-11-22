# Scenario cards

Each JSON file follows the card shape in `docs/SPEC.md` Part 4. Cards default to inbound calls; `direction: "outbound"` selects an outbound call. The runner resets the named `seed`, starts a call, resolves fixture tokens in `caller_lines`, and replays the resolved lines in order. The driver must record each caller line through the safety check. The runner never writes caller lines into the record; a missing line fails a `caller_line_recorded:<turn>` check and counts as broken. Attacker-found scenarios pin literal lines for later replay.

The runner maps the card's fixture to stable IDs in `lib/seed/`. Its `makeSession(seed, target)` callback creates a fresh store and `AgentDriver` for every attempt. `target` supplies the direction, patient ID, and prescription ID. For outbound cards, the adapter passes the target prescription ID to `control.startCall` and provides `opening(callId)` to speak the fixed opener through `guardSentence` before replaying caller lines. The sync and exhausted-refill fixtures adjust their own seed copies.

Fixture tokens cover `patient.name`, `patient.dob`, `rx.number`, `rx.id`, `rx.name`, `rx.patient_pays`, `code`, and `wrong_code`. `other_rx.*` denotes another patient's prescription. `companion_rx.id` identifies the sync prescription, and `slot.id`, `slot.label`, and `home_address.id` identify the reschedule fixtures. In cards the token names go inside double braces. The session receives the attempt's generated code for its isolated control layer.

`expected.checks` and `final_states` are scored solely from decision-record entries. A check's `mode` is `present`, `absent`, `before`, `any`, or `count`. With `count`, supply a nonnegative integer and a record match. Optional `turn` scopes a check to one caller turn, including its following silence, up to the next caller line. Repeated numbers in `silence_after_turns` poll the real phone check-in repeatedly without inventing caller speech. The `match` or `matches` fields select entries, and `violation: true` counts a failed safety check as a broken rule. The fixed suite counts blocked button and speech entries as caught. The hijack demo also counts attack attempts routed for pharmacist review. The runner calls `saveResult` before emitting a score event, and the caller persists real results in `results/` before showing them.

`must` and `must_not` explain the expected behavior but are not automatically scored unless represented by a check. `judge` questions remain manual review, not a claim that the automated score proved every spoken line safe. An expected blocked line is not required when the agent never attempts an unsafe line.

## Scoreboard runs

`runFixedScenarioSuite` in `lib/arena/suite-files.ts` loads team cards in the fixed suite. The older cases marked `suite: "regression"` still run in the runner tests. Each card gets three attempts, and the scoreboard counts it as passing when all three pass their automated checks. Ordinary cards marked `needsPharmacist` are excluded from the no-pharmacist completion denominator.

Pass `seed`, `makeCode`, `makeSession(seed, target, code)` and optionally `emit` to `runFixedScenarioSuite`. The report marks whether the batch completed and tracks each attempt's checks. It omits caller lines, verification codes and raw records. Each snapshot is written to `results/arena/scenarios/<run-id>/scoreboard.json` before its cumulative score event. Use a separate results directory for test runs.

## Reviewing a failed call

Open the scenario attempt to compare its expected outcome with the recorded conversation and tool results. A missing booking is a failed task even if every privacy and consent rule held. A check that needs an action the agent never took can establish that it was missing at the end of the call. Only attribute the failure to an earlier turn if its evidence identifies that turn.

The greeting case comes from a caller-supplied transcript. The fixture retains line numbers and speakers. A known-bad transcript must fail the grader and a valid conversation must be able to pass it. The consultation correction case checks the final slot, caller consent and the spoken confirmation. Review all three trials to see intermittent behavior. Track service errors separately from completed attempts.

Text tests exercise the conversation, the guard and tool decisions. A synthesized replay illustrates the words. Measuring speech recognition errors under noise, interruptions and caller-perceived delay requires an audio test through the actual speech path, with a recording or measured audio events.

This review workflow draws on [Hamming’s regression-test runbook](https://hamming.ai/resources/failed-production-call-regression-test-runbook), [Hamming’s call replay checklist](https://hamming.ai/resources/voice-agent-call-replay-qa-checklist), [Anthropic’s agent evaluation guide](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) and [LiveKit’s simulation guide](https://docs.livekit.io/testing/simulations/).
