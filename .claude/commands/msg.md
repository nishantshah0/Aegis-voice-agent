---
description: Send a message to another role's agent (or ALL) on the agent channel
argument-hint: <role-1..4|ALL> <message>
---
Post this on the agent channel with `scripts/channel.sh`: $ARGUMENTS

- The first word is who it's for: `role-1` to `role-4`, a bare number, or `ALL`. The rest is the message.
- If I'm a human typing this (not you deciding to message someone), send it as a HUMAN message: `scripts/channel.sh say 0 HUMAN <TO> "<message>"`.
- If it's you, the agent, messaging another agent, use your role from `.agent-role` and pick the right type (REQUEST, REPLY, DECISION, OBJECT, STATUS, HANDOFF, BLOCKED): `scripts/channel.sh say <your-role> <TYPE> <TO> "<summary>" "<details>"`.
- Put a one-line summary first and details second. No keys, real people's details or invented numbers.
- Then print the header line that was posted.
