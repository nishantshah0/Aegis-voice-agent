#!/usr/bin/env bash
# Run one role's agent headlessly, one cycle every CYCLE_MINUTES (default 15), until a HUMAN says STOP.
#   scripts/agent-loop.sh <role-number>
# Needs the Claude Code CLI (`claude`) signed in. Every cycle is captured by Entire.
set -euo pipefail
ROLE="${1:?usage: $0 <role-number 1-4>}"
PROMPT_FILE="agents/role-$ROLE.md"
[ -f "$PROMPT_FILE" ] || { echo "no $PROMPT_FILE" >&2; exit 2; }
MINUTES="${CYCLE_MINUTES:-15}"
cd "$(git rev-parse --show-toplevel)"
while true; do
  if scripts/channel.sh stopped >/dev/null; then
    echo "$(date +%H:%M) STOP is in effect. Checking again in $MINUTES minutes."
  else
    echo "$(date +%H:%M) Role $ROLE: starting a cycle"
    claude -p "$(cat "$PROMPT_FILE")

Run one cycle now, then stop." --permission-mode acceptEdits || echo "$(date +%H:%M) cycle ended with an error"
  fi
  sleep $((MINUTES * 60))
done
