---
description: Show new messages for this machine's role on the agent channel, and deal with them
argument-hint: "[role]"
---
Run `scripts/channel.sh inbox <role>`, where the role is $ARGUMENTS if given, otherwise the number in `.agent-role`. If neither is set, ask me which role (1 to 4) and save it with `echo <n> > .agent-role`.

Show me the new messages briefly, newest last. Then:
- Follow HUMAN messages first.
- Answer every REQUEST, REVIEW or OBJECT addressed to this role with a REPLY (`scripts/channel.sh say <role> REPLY <to> "..."`), or tell me what you'd answer if it needs my decision.
- Note any DECISION that affects our work, and post OBJECT if it conflicts with our folders, the contract or `docs/DECISIONS.md`.
If there's nothing new, say so in one line.
