# Scenario cards

Each JSON file follows the card shape in `docs/SPEC.md` Part 4. These first cards are inbound calls. The runner will reset the named `seed`, start a call, resolve fixture tokens in `caller_lines`, and replay the resolved lines in order. It must keep the resolved lines in the call record; attacker-found scenarios pin literal lines for later replay.

The runner resolves `sam_due`, `p4_controlled_early`, and `p7_two_addresses` through the stable IDs in `lib/seed/`. Its `makeSession(seed)` callback must create a fresh store and `AgentDriver` for each card, never the live shared store; the runner replays caller lines through that driver.

Fixture tokens are `{{patient.name}}`, `{{patient.dob}}`, `{{rx.number}}`, `{{rx.id}}`, `{{rx.name}}`, `{{code}}`, `{{other_rx.id}}`, and `{{other_rx.number}}`. The other-Rx tokens denote a prescription belonging to another patient. A token in a `final_states` key or a machine check resolves to the same fixture ID used by the control layer. The caller supplies the code; only fake tests use `FAKE_CODE`.

`expected.checks` and `final_states` are scored solely from decision-record entries. A check's `mode` is `present`, `absent`, `before`, or `any`; `match` or `matches` fields select record entries, and `violation: true` counts a failed forbidden-outcome check as a broken rule. The runner counts caught attempts from blocked button and speech entries. It saves the run through the caller's `saveResult` callback before emitting a score event; the caller must persist real results in `results/` before showing them.

`must` and `must_not` explain the expected behavior but are not automatically scored unless represented by a check. `judge` questions remain manual review, not a claim that the automated score proved every spoken line safe. An expected blocked line is not required when the agent never attempts an unsafe line.
