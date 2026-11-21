#!/usr/bin/env bash
# The agent channel: GitHub issue #1. Every AI agent and human talks here.
#
#   scripts/channel.sh say <ROLE> <TYPE> <TO> "<summary>" ["<details>"]
#       e.g. scripts/channel.sh say 2 REQUEST 4 "Need Lane on QueueItem" "Branch role-2/today-view"
#       humans: scripts/channel.sh say 0 HUMAN ROLE-1 "do 1.1 next"   (or ALL)
#   scripts/channel.sh inbox <ROLE>    only NEW messages for ROLE since you last checked (marks them read)
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

# All messages as JSON lines: {"t": time, "u": login, "b": body}
messages() {
  gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100" --paginate \
    --jq '.[] | {t: .created_at, u: .user.login, b: .body} | @json'
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
    role="$2"; type="$(echo "$3" | tr '[:lower:]' '[:upper:]')"; to="$4"; summary="$5"; details="${6:-}"
    case " $TYPES " in *" $type "*) ;; *) echo "unknown type: $type (use: $TYPES)" >&2; exit 2;; esac
    to="$(echo "$to" | tr '[:lower:]' '[:upper:]' | sed 's/^\([0-9]\)$/ROLE-\1/')"
    if [ "$type" = "HUMAN" ]; then header="[HUMAN · $to] $summary"; else header="[ROLE-$role · $type → $to] $summary"; fi
    body="$header"; [ -n "$details" ] && body="$header

$details"
    gh issue comment "$ISSUE" --repo "$REPO" --body "$body" >/dev/null && echo "posted: $header"
    ;;
  inbox)
    role="${2:?usage: $0 inbox <ROLE>}"
    mkdir -p "$STATE_DIR"; mark="$STATE_DIR/last-seen-role-$role"; tmp="$(mktemp)"
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
    messages | "$PY" -c '
import sys, json, re
# Keep this rule in sync with openItems() in scripts/channel-view.mjs.
HEAD = re.compile(r"^\[(?:ROLE-(\d)|HUMAN) · (?:([A-Z]+) → ([A-Z0-9-]+)|([A-Z0-9-]+))\] *(.*)$")
msgs = []
for line in sys.stdin:
    if not line.strip():
        continue
    m = json.loads(line)
    h = HEAD.match(m["b"].split("\n", 1)[0])
    if not h:
        continue
    human = not h.group(1) or h.group(1) == "0"
    to = (h.group(3) or h.group(4)).replace("ROLE-0", "HUMAN")
    msgs.append({"t": m["t"], "from": "HUMAN" if human else "ROLE-" + h.group(1),
                 "type": "HUMAN" if human and not h.group(2) else h.group(2), "to": to, "s": h.group(5)})
def answered(i, m):
    for r in msgs[i + 1:]:
        if m["type"] == "BLOCKED":
            if r["type"] in ("HUMAN", "REPLY") and r["to"] in (m["from"], "ALL") and r["from"] != m["from"]:
                return True
        elif r["from"] == m["to"] or (m["to"] in ("ALL", "HUMAN") and r["from"] != m["from"]):
            if r["type"] == "REPLY" and r["to"] == m["from"]:
                return True
            if r["type"] in ("HANDOFF", "MERGED", "HUMAN") and r["to"] in (m["from"], "ALL"):
                return True
    return False
me = "ROLE-" + sys.argv[1]
open_ = [m for i, m in enumerate(msgs) if m["type"] in ("REQUEST", "OBJECT", "BLOCKED") and not answered(i, m)]
owe = [m for m in open_ if m["type"] != "BLOCKED" and m["to"] in (me, "ALL") and m["from"] != me]
wait = [m for m in open_ if m["from"] == me]
def show(title, items, empty):
    print(title)
    for m in items:
        print("  %s  %s %s → %s: %s" % (m["t"].replace("T", " ")[:16], m["type"], m["from"], m["to"], m["s"]))
    if not items:
        print("  " + empty)
    print()
show("You owe an answer (post a REPLY addressed to the role that asked):", owe, "nothing")
show("You are waiting on:", wait, "nothing")
' "$role"
    ;;
  stopped)
    last=$(messages | "$PY" -c '
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
    sed -n '2,19p' "$0"; exit 2
    ;;
esac
