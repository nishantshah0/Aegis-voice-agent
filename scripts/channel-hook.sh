#!/usr/bin/env bash
# Claude Code hook (SessionStart and UserPromptSubmit): hands the agent any NEW
# messages for its role from the agent channel, so it never misses one.
#
# Set your role once per machine:   echo 2 > .agent-role     (git-ignored)
# or for one session:               AGENT_ROLE=2 claude
#
# Prints nothing when there's no role, no new messages, or no network. Never fails.
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0
role="${AGENT_ROLE:-$( { tr -dc '1-4' < .agent-role; } 2>/dev/null | head -c1)}"
[ -n "$role" ] || exit 0
command -v gh >/dev/null 2>&1 || exit 0

new="$(scripts/channel.sh inbox "$role" 2>/dev/null)" || new=""
# Print the channel inbox first: inbox has already marked these messages read, so they must reach the agent
# even if the Trail check below is slow.
if [ -n "$new" ]; then
  case "$new" in
    *"=== URGENT"*) echo "URGENT messages for Role $role (GitHub issue #11). Stop what you're doing and handle them first: answer with scripts/channel.sh urgent <your role> REPLY <their role> \"...\". Then the normal channel (issue #1):" ;;
    *) echo "New messages for Role $role on the agent channel (GitHub issue #1). HUMAN messages come first. Answer REQUESTs and OBJECTs addressed to you with a REPLY via scripts/channel.sh:" ;;
  esac
  echo; echo "$new"; echo
fi
# Then open review findings on this role's Trails (about 8 s at most, inside the hook's 15 s timeout).
trail="$(scripts/channel.sh trail-inbox "$role" --if-changed 2>/dev/null)" || trail=""
if [ -n "$trail" ]; then
  echo "Entire Trails for Role $role: open review findings and human steering. Handle these before starting new work:"
  echo; echo "$trail"
fi
exit 0
