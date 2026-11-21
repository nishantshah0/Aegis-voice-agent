#!/usr/bin/env bash
# The agent channel: GitHub issue #1. Every AI agent talks here.
#
#   scripts/channel.sh say <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
#       e.g. scripts/channel.sh say 2 REQUEST 4 "Need Lane on QueueItem" "Branch platform/today-view"
#   scripts/channel.sh read [N]        last N messages (default 15)
#   scripts/channel.sh for <ROLE>      unread-style view: messages addressed to ROLE or ALL, last 15
#   scripts/channel.sh stopped         exits 0 if a HUMAN has posted STOP since the last GO
#
# Types: CLAIM STATUS REQUEST REPLY HANDOFF BLOCKED REVIEW MERGED HUMAN
set -euo pipefail

REPO="${AGENT_CHANNEL_REPO:-nishantshah0/namereserve}"
ISSUE="${AGENT_CHANNEL_ISSUE:-1}"
TYPES="CLAIM STATUS REQUEST REPLY HANDOFF BLOCKED REVIEW MERGED HUMAN"

bodies() {
  gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100" --paginate \
    --jq '.[] | "\(.created_at) \(.user.login)\n\(.body)\n---"'
}

case "${1:-}" in
  say)
    [ $# -ge 5 ] || { echo "usage: $0 say <ROLE> <TYPE> <TO> \"<summary>\" [\"<details>\"]" >&2; exit 2; }
    role="$2"; type="$(echo "$3" | tr '[:lower:]' '[:upper:]')"; to="$4"; summary="$5"; details="${6:-}"
    case " $TYPES " in *" $type "*) ;; *) echo "unknown type: $type (use: $TYPES)" >&2; exit 2;; esac
    if [ "$type" = "HUMAN" ]; then header="[HUMAN · $to] $summary"; else header="[ROLE-$role · $type → $(echo "$to" | sed 's/^[0-9]$/ROLE-&/')] $summary"; fi
    body="$header"; [ -n "$details" ] && body="$header

$details"
    gh issue comment "$ISSUE" --repo "$REPO" --body "$body" >/dev/null && echo "posted: $header"
    ;;
  read)
    n="${2:-15}"
    bodies | awk -v RS='\n---\n' -v n="$n" '{a[NR]=$0} END {s=NR-n+1; if (s<1) s=1; for (i=s;i<=NR;i++) print a[i] "\n"}'
    ;;
  for)
    role="${2:?usage: $0 for <ROLE>}"
    bodies | awk -v RS='\n---\n' -v r="ROLE-$role" '$0 ~ ("→ " r "\\]") || $0 ~ "→ ALL\\]" || $0 ~ /\[HUMAN/ {a[++k]=$0} END {s=k-14; if (s<1) s=1; for (i=s;i<=k;i++) print a[i] "\n"}'
    ;;
  stopped)
    last=$(bodies | grep -E '^\[HUMAN · [^]]*\] *(STOP|GO)\b' | tail -1 || true)
    case "$last" in *"] STOP"*) echo "STOP is in effect"; exit 0;; *) exit 1;; esac
    ;;
  *)
    sed -n '2,12p' "$0"; exit 2
    ;;
esac
