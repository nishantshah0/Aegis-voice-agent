@AGENTS.md

# Claude Code notes for Refill Guard

Everything in `AGENTS.md` applies. These notes are specific to Claude Code.

## Your role

Ask the human which role you're working as (1 to 4) if it isn't clear from the conversation, then read `agents/role-<n>.md`. For an autonomous run, the human starts you with:

```
/loop Follow agents/role-<n>.md. Run one cycle of the loop in docs/AUTONOMY.md, then wait for the next cycle.
```

Each cycle does at most one task, or about 45 minutes of work, and ends with a STATUS line on the channel.

## This session is recorded

Entire's hooks (in `.claude/settings.json`) capture this session and link it to every commit you make, through an `Entire-Checkpoint` trailer. Transcripts go to the private repo `nishantshah0/namereserve-sessions`. Never put keys, real people's details or invented numbers in the chat, a file or a commit.

The `entire` skill (`.claude/skills/entire/`) explains the CLI. Run `entire agent-help <command>` for exact flags rather than guessing.

## Ask the human before

- Any Entire setup or account command: `entire enable`, `disable`, `clean`, `login`, `auth`, `configure`, `repo`, `project`, `plugin`.
- Anything that spends money or tokens in the background (Brain backfill or daemon, overnight runs).
- Merging anything into `main` that touches `lib/contract/`, `lib/control/` or `lib/guard/`.
- Destructive git: force push, history rewrite, `reset --hard`, deleting branches.

## Using the Claude API in the product

- Agent model ids: `claude-sonnet-5-5` (default for the call), `claude-haiku-5-5` (safety and advice checks), `claude-fable-5-2` (attack planner, rule writer, fixes). Use the exact ids, with no date suffix.
- Own the tool loop with the Messages API, so every tool call passes through the control layer. Use automatic tool choice with `strict: true` tool schemas, because forced tool choice is rejected on these models.
- Check `stop_reason` for `refusal` on every response. Fable 5.2 always thinks, so control depth with `output_config.effort` and leave the thinking setting out.
- Keys come from `.env` on the server only.

<!-- entire-agent:begin -->
<!-- Entire agent instructions are inherited through AGENTS.md. -->
<!-- entire-agent:end -->
