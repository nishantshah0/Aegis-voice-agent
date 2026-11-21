# Scenario cards

Each JSON file follows the card shape in `docs/SPEC.md` Part 4. These first cards are inbound calls. The runner will reset the named `seed`, start a call, resolve fixture tokens in `caller_lines`, and replay the resolved lines in order. It must keep the resolved lines in the call record; attacker-found scenarios pin literal lines for later replay.

The seed names describe the state needed from Role 4's fixtures. `sam_due` is Sam's Tuesday demo state; `p4_controlled_early` is a controlled prescription before its permitted interval; `p7_two_addresses` has two on-file addresses. Final seed and prescription IDs will be aligned when task 0 lands.

Fixture tokens are `{{patient.name}}`, `{{patient.dob}}`, `{{rx.number}}`, `{{rx.id}}`, `{{rx.name}}`, `{{code}}`, and `{{other_rx.number}}`. The last token denotes a prescription belonging to another patient. A token in a `final_states` key resolves to the same fixture ID used by the control layer.

`expected.final_states`, `must`, and `must_not` are conditions on the decision record and resulting state. `judge` is reserved for questions about actual spoken lines; any answer must quote the transcript. An expected blocked line is not required when the agent never attempts an unsafe line.
