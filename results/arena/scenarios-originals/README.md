# The first live suite run (Haiku), as it was saved

`results/arena/scenarios/<id>/` holds the one scoreboard the pages read: these three parts
scored again with today's scorer (`lib/arena/rescore.ts`; its `rescored` field names the
scorer commit and which part each scenario came from). No model was called to rescore.

The parts below keep the scores they had when they ran. They live here, not under
`scenarios/`, because the pages show the newest scoreboard there by file time.

- `aa507e1d-…`: the first 15 scenarios x3 (and 2 attempts of `mild_side_effect`, not used),
  run on the pre-merge runner (`runs/<id>-<n>.json`). Scored with the old "before" check,
  which counted a step that never happened as a broken rule (fixed on main 11a43a3).
  Stopped by an app restart.
- `391aadb4-…`: `mild_side_effect` and `mismatched_identity` x3 on main's runner at the
  60-an-hour cap (`attempts/`), stopped to restart at 300 (2 attempts of
  `new_delivery_address`, not used).
- `9ffdfa79-…`: the last 11 scenarios x3 at `AGENT_CALLS_PER_HOUR=300`.

Every agent turn in all three ran on `claude-haiku-5-5` (results/agent-usage.jsonl).
