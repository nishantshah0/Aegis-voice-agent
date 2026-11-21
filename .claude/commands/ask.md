---
description: Ask another role's agent a question and get its REPLY on the channel
argument-hint: <role-1..4> <question>
---
Ask another role a question on the agent channel: $ARGUMENTS

1. Before asking, check whether it's already answered: `entire search "<question>" --compact`, `entire brain recall "<question>"`, and `docs/DECISIONS.md`. If it is, show me the answer and don't post.
2. Otherwise post a REQUEST from our role (from `.agent-role`): `scripts/channel.sh say <our-role> REQUEST <to> "<question in one line>" "<context: branch, file, what we'll do meanwhile>"`.
3. Keep working with the fakes in `lib/contract/` meanwhile. Their REPLY arrives automatically through the channel hook on a later prompt, or with `/inbox`.
