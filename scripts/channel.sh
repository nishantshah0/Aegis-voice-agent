#!/usr/bin/env bash
# The agent channel: GitHub issue #1. Every AI agent and human talks here.
# The URGENT channel: GitHub issue #11. Only for things that can't wait (see docs/AUTONOMY.md).
#
#   scripts/channel.sh say <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
#       e.g. scripts/channel.sh say 2 REQUEST 4 "Need Lane on QueueItem" "Branch role-2/today-view"
#       humans: scripts/channel.sh say 0 HUMAN ROLE-1 "do 1.1 next"   (or ALL)
#   scripts/channel.sh urgent <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
#                                      same as say, but on the URGENT channel. Use it rarely.
#   scripts/channel.sh urgent-read [N] the last N urgent messages (default 10)
#   scripts/channel.sh inbox <ROLE>    only NEW messages for ROLE since you last checked (marks them read),
#                                      urgent ones first
#   scripts/channel.sh for <ROLE>      the last 15 messages for ROLE, read or not
#   scripts/channel.sh read [N]        the last N messages for everyone (default 15)
#   scripts/channel.sh watch [ROLE]    live feed: prints new messages as they arrive (Ctrl-C to stop)
#   scripts/channel.sh stopped         exits 0 if a HUMAN has posted STOP since the last GO
#   scripts/channel.sh waiting <ROLE>  what ROLE still owes others (unanswered REQUEST, OBJECT, BLOCKED to it)
#                                      and what ROLE is still waiting on. Same rule as the board's "Waiting on someone".
#   scripts/channel.sh trails          every Entire Trail mentioned on the channel, newest mention first
#                                      (teammates can't list Trails on entire.com: see docs/ENTIRE.md)
#
# Types: CLAIM STATUS DECISION OBJECT REQUEST REPLY HANDOFF BLOCKED REVIEW MERGED HUMAN
# A message is "for" ROLE n when it's addressed to ROLE-n or ALL, or it's a HUMAN message to ROLE-n or ALL.
# Your own messages never show up in your inbox.
set -euo pipefail

REPO="${AGENT_CHANNEL_REPO:-nishantshah0/namereserve}"
ISSUE="${AGENT_CHANNEL_ISSUE:-1}"
URGENT_ISSUE="${AGENT_URGENT_ISSUE:-11}"
TYPES="CLAIM STATUS DECISION OBJECT REQUEST REPLY HANDOFF BLOCKED REVIEW MERGED HUMAN"
STATE_DIR="$(git rev-parse --git-dir 2>/dev/null || echo .git)/agent-channel"

# A Python that really runs. On Windows, "python3" can be the Microsoft Store stub.
PY=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
[ -n "$PY" ] || { echo "channel.sh needs Python 3 on PATH" >&2; exit 1; }
# Messages are UTF-8 (headers use "·" and "→"). Windows Python defaults to cp1252, which made
# every header fail to parse, so inbox, waiting and even `stopped` saw nothing. Force UTF-8.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1

# All messages as JSON lines: {"t": time, "u": login, "b": body}
# Pass an issue number to read another channel (the urgent one is $URGENT_ISSUE).
messages() {
  gh api "repos/$REPO/issues/${1:-$ISSUE}/comments?per_page=100" --paginate \
    --jq '.[] | {t: .created_at, u: .user.login, b: .body} | @json'
}

# Both channels, oldest first. Urgent lines carry "urgent": true.
all_messages() {
  # gh prints JSON keys sorted, so sort on a time prefix, then drop it.
  {
    gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100" --paginate \
      --jq '.[] | .created_at + "\t" + ({t: .created_at, u: .user.login, b: .body} | @json)'
    gh api "repos/$REPO/issues/$URGENT_ISSUE/comments?per_page=100" --paginate \
      --jq '.[] | .created_at + "\t" + ({t: .created_at, u: .user.login, b: .body, urgent: true} | @json)' 2>/dev/null || true
  } | sort | cut -f2-
}

# Post a message. Args: issue role type to summary [details]
post() {
  issue="$1"; role="$2"; type="$(echo "$3" | tr '[:lower:]' '[:upper:]')"; to="$4"; summary="$5"; details="${6:-}"
  case " $TYPES " in *" $type "*) ;; *) echo "unknown type: $type (use: $TYPES)" >&2; exit 2;; esac
  to="$(echo "$to" | tr '[:lower:]' '[:upper:]' | sed 's/^\([0-9]\)$/ROLE-\1/')"
  if [ "$type" = "HUMAN" ]; then header="[HUMAN · $to] $summary"; else header="[ROLE-$role · $type → $to] $summary"; fi
  body="$header"; [ -n "$details" ] && body="$header

$details"
  gh issue comment "$issue" --repo "$REPO" --body "$body" >/dev/null && echo "posted${7:+ $7}: $header"
}

# Filter and print messages. Args: role ("" for everyone), since (ISO time or ""), last-n (0 = all)
show() {
  "$PY" -c '
import sys, json
role, since, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
out = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    m = json.loads(line)
    if since and m["t"] <= since:
        continue
    head = m["b"].split("\n", 1)[0]
    if role:
        r = "ROLE-" + role
        mine = head.startswith("[" + r + " ·")
        to_me = ("→ " + r + "]") in head or "→ ALL]" in head \
            or head.startswith("[HUMAN · " + r + "]") or head.startswith("[HUMAN · ALL]")
        if mine or not to_me:
            continue
    out.append(m)
if n:
    out = out[-n:]
for m in out:
    print(m["t"].replace("T", " ").replace("Z", ""), m["u"])
    print(m["b"])
    print()
if out:
    sys.stderr.write(out[-1]["t"])
' "$1" "$2" "$3"
}

case "${1:-}" in
  say)
    [ $# -ge 5 ] || { echo "usage: $0 say <ROLE> <TYPE> <TO> \"<summary>\" [\"<details>\"]" >&2; exit 2; }
    post "$ISSUE" "$2" "$3" "$4" "$5" "${6:-}"
    ;;
  urgent)
    [ $# -ge 5 ] || { echo "usage: $0 urgent <ROLE> <TYPE> <TO> \"<summary>\" [\"<details>\"]" >&2; exit 2; }
    post "$URGENT_ISSUE" "$2" "$3" "$4" "$5" "${6:-}" "URGENT (issue #$URGENT_ISSUE)"
    ;;
  urgent-read)
    messages "$URGENT_ISSUE" | show "" "" "${2:-10}" 2>/dev/null
    ;;
  inbox)
    role="${2:?usage: $0 inbox <ROLE>}"
    mkdir -p "$STATE_DIR"; mark="$STATE_DIR/last-seen-role-$role"; tmp="$(mktemp)"
    umark="$STATE_DIR/last-seen-urgent-role-$role"; utmp="$(mktemp)"
    usince="$(cat "$umark" 2>/dev/null || true)"
    urgent="$(messages "$URGENT_ISSUE" 2>/dev/null | show "$role" "$usince" 0 2>"$utmp" || true)"
    if [ -n "$urgent" ]; then
      echo "=== URGENT (issue #$URGENT_ISSUE): handle these before anything else, then REPLY with scripts/channel.sh urgent ==="
      echo; echo "$urgent"; echo "=== end of urgent ==="; echo
    fi
    [ -s "$utmp" ] && cp "$utmp" "$umark"; rm -f "$utmp"
    since="$(cat "$mark" 2>/dev/null || true)"
    messages | show "$role" "$since" 0 2>"$tmp"
    [ -s "$tmp" ] && cp "$tmp" "$mark"; rm -f "$tmp"
    ;;
  for)
    role="${2:?usage: $0 for <ROLE>}"
    messages | show "$role" "" 15 2>/dev/null
    ;;
  read)
    messages | show "" "" "${2:-15}" 2>/dev/null
    ;;
  watch)
    role="${2:-}"; every="${WATCH_SECONDS:-30}"; tmp="$(mktemp)"
    echo "Watching the agent channel${role:+ for Role $role} every ${every}s. Ctrl-C to stop."
    echo
    messages | show "$role" "" 5 2>"$tmp"; since="$(cat "$tmp")"
    while sleep "$every"; do
      : >"$tmp"
      messages | show "$role" "$since" 0 2>"$tmp" || true
      [ -s "$tmp" ] && since="$(cat "$tmp")"
    done
    ;;
  trails)
    messages | "$PY" -c '
import sys, json, re
seen = {}
for line in sys.stdin:
    if not line.strip():
        continue
    m = json.loads(line)
    head = m["b"].split("\n", 1)[0]
    for n in set(re.findall(r"(?:[Tt]rail\s*#\s*|/trails/)(\d+)", m["b"])):
        seen[int(n)] = (m["t"], head)
if not seen:
    print("No Trails mentioned on the channel yet. Put \"Trail #<n>\" in your CLAIM and HANDOFF messages.")
    sys.exit(0)
print("Trails mentioned on the agent channel (open one with: entire trail show <n> --project gh/nishantshah0)\n")
for n, (t, head) in sorted(seen.items(), key=lambda kv: kv[1][0], reverse=True):
    print("  #%-4d %s  %s" % (n, t.replace("T", " ")[:16], head[:110]))
'
    ;;
  waiting)
    role="${2:?usage: $0 waiting <ROLE>}"
    all_messages | "$PY" "$(dirname "$0")/channel_waiting.py" "$role"
    ;;
  stopped)
    last=$(all_messages | "$PY" -c '
import sys, json, re
last = ""
for line in sys.stdin:
    if line.strip():
        head = json.loads(line)["b"].split("\n", 1)[0]
        if re.match(r"^\[HUMAN · [^]]*\] *(STOP|GO)\b", head):
            last = head
print(last)')
    case "$last" in *"] STOP"*) echo "STOP is in effect"; exit 0;; *) exit 1;; esac
    ;;
  *)
    sed -n '2,24p' "$0"; exit 2
    ;;
esac
