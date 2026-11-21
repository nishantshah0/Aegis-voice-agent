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
#   scripts/channel.sh trail-inbox <ROLE>  open Entire review findings on ROLE's Trails, and new human comments
#                                      on Trail #2. Add --if-changed to print only when something changed
#                                      (the hook uses this). Fix findings before new work.
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
  # HUMAN messages override everything, so only people may post them. Refuse from an AI agent's shell
  # (Claude Code sets CLAUDECODE; .agent-role marks an agent's checkout). A person in their own terminal
  # sets HUMAN_POST=1 on purpose. Agents must never set it: use REQUEST, REVIEW or BLOCKED instead.
  if [ "$type" = "HUMAN" ] && [ "${HUMAN_POST:-}" != "1" ]; then
    if [ -n "${CLAUDECODE:-}${CURSOR_AGENT:-}${CODEX_SANDBOX:-}${AGENT_ROLE:-}" ] || [ -s "$(git rev-parse --show-toplevel 2>/dev/null)/.agent-role" ]; then
      echo "refused: HUMAN messages are for people only, and this looks like an AI agent's shell." >&2
      echo "Agents: post REQUEST, REVIEW or BLOCKED instead. People: run it in your own terminal with HUMAN_POST=1." >&2
      exit 3
    fi
  fi
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
  trail-inbox)
    role="${2:?usage: $0 trail-inbox <ROLE> [--if-changed]}"; only_changed="${3:-}"
    mkdir -p "$STATE_DIR"
    command -v entire >/dev/null 2>&1 || { echo "entire CLI not found: can't read Trail findings (see SETUP.md)"; exit 0; }
    out="$(messages | "$PY" -c '
import sys, json, re, subprocess, concurrent.futures as cf
role, project, state = "ROLE-" + sys.argv[1], sys.argv[2], sys.argv[3]
HEAD = re.compile(r"^\[(?:ROLE-(\d)|HUMAN) · ")
owner = {}
for line in sys.stdin:
    if not line.strip():
        continue
    m = json.loads(line)
    h = HEAD.match(m["b"])
    if not h or not h.group(1) or h.group(1) == "0":
        continue
    for n in re.findall(r"(?:[Tt]rail\s*#\s*|/trails/)(\d+)", m["b"]):
        owner.setdefault(int(n), "ROLE-" + h.group(1))  # first role to mention a Trail owns it
if role == "ROLE-4":
    # Trails no role has named on the channel go to the integrator, so their findings are not lost.
    try:
        listed = subprocess.run(["entire", "trail", "list", "--project", project, "--json", "--limit", "100"], capture_output=True, text=True, timeout=4)
        for t in json.loads(listed.stdout or "{}").get("items") or []:
            owner.setdefault(int(t["number"]), "ROLE-4")
    except Exception:
        pass
mine = sorted([n for n, r in owner.items() if r == role and n != 2], reverse=True)[:12]

import time
DEADLINE = time.monotonic() + 8          # the hook has 15 s in all, and the channel inbox runs first
def entire(*args):
    left = DEADLINE - time.monotonic()
    if left < 0.5:
        raise RuntimeError("skipped: out of time (run scripts/channel.sh trail-inbox by hand)")
    r = subprocess.run(["entire", *args, "--project", project, "--json"], capture_output=True, text=True, timeout=min(4, left))
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "failed")
    return json.loads(r.stdout or "{}")

def findings(n):
    try:
        return n, entire("trail", "finding", "list", "--trail", str(n), "--status", "open", "--freshness", "any"), None
    except subprocess.TimeoutExpired:
        return n, None, "timed out (Entire is slow right now; run scripts/channel.sh trail-inbox by hand)"
    except Exception as e:
        return n, None, str(e)

lines, errors = [], []
with cf.ThreadPoolExecutor(6) as ex:
    for n, d, err in ex.map(findings, mine):
        if err and "no open changes" in err:
            continue  # a Trail with no branch yet has no findings
        if err:
            errors.append("Trail #%d: %s" % (n, err[:160]))
            continue
        fs = d.get("findings") or []
        if not fs:
            continue
        rank = {"high": 0, "medium": 1, "low": 2}
        fs.sort(key=lambda f: rank.get(f.get("severity") or "low", 3))
        lines.append("Trail #%d: %d open" % (n, len(fs)))
        for f in fs:
            body = " ".join((f.get("body") or f.get("title") or "").split())
            cut = len(body) > 400
            lines.append("  [%s] %s  %s%s" % (f.get("severity") or "?", f.get("id", "?"), body[:400], " ..." if cut else ""))
            if cut:
                lines.append("      full text: entire trail finding show %s --trail %d --project %s" % (f.get("id", "?"), n, project))
if lines:
    print("=== Open review findings on %s Trails. Fix them before new work, then reply on each finding (entire trail finding reply, or apply a suggested patch). Never resolve or dismiss a finding yourself: the code reviewer does. ===" % role.replace("ROLE-", "Role "))
    print("\n".join(lines))
if errors:
    print("=== Could not read some Trails from this login (check entire auth status; if it persists, post BLOCKED to ROLE-2, the project owner) ===")
    print("\n".join(errors))

# New human comments on Trail #2 (humans steer there; Entire blocks agents from commenting)
mark = state + "/trail2-seen-" + role
try:
    seen = open(mark).read().strip()
except OSError:
    seen = ""
try:
    items = entire("trail", "comment", "list", "--trail", "2").get("items") or []
    new = [c for c in items if (c.get("createdAt") or c.get("created_at") or "") > seen]
    if new:
        print("=== New human comments on Trail #2 (human steering: obey these like HUMAN messages) ===")
        for c in new:
            print("  %s %s" % ((c.get("createdAt") or c.get("created_at") or "")[:16], " ".join((c.get("body") or "").split())[:400]))
        open(mark, "w").write(max((c.get("createdAt") or c.get("created_at") or "") for c in new))
except Exception as e:
    print("=== Could not read Trail #2 comments: %s ===" % str(e)[:160])
' "$role" "gh/${REPO%%/*}" "$STATE_DIR")"
    if [ "$only_changed" = "--if-changed" ]; then
      # The state file holds "<checksum> <unix time last shown>" (no stat: its flags differ on macOS and Linux).
      sum="$(printf '%s' "$out" | cksum | cut -d' ' -f1)"; now="$(date +%s)"
      { read -r last when < "$STATE_DIR/trail-inbox-sum-$role"; } 2>/dev/null || { last=""; when=0; }
      case "$when" in ''|*[!0-9]*) when=0;; esac
      [ "$sum" = "$last" ] && [ $(( now - when )) -lt 900 ] && exit 0   # unchanged, and shown in the last 15 minutes
      echo "$sum $now" > "$STATE_DIR/trail-inbox-sum-$role"
    fi
    [ -n "$out" ] && echo "$out"
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
    all_messages | "$PY" -c '
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
                 "type": "HUMAN" if human and not h.group(2) else h.group(2), "to": to, "s": h.group(5), "u": m.get("urgent", False)})
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
open_.sort(key=lambda m: not m["u"])  # urgent first
owe = [m for m in open_ if m["type"] != "BLOCKED" and m["to"] in (me, "ALL") and m["from"] != me]
wait = [m for m in open_ if m["from"] == me]
def show(title, items, empty):
    print(title)
    for m in items:
        print("  %s  %s%s %s → %s: %s" % (m["t"].replace("T", " ")[:16], "URGENT " if m["u"] else "", m["type"], m["from"], m["to"], m["s"]))
    if not items:
        print("  " + empty)
    print()
show("You owe an answer (post a REPLY addressed to the role that asked):", owe, "nothing")
show("You are waiting on:", wait, "nothing")
' "$role"
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
    sed -n '2,27p' "$0"; exit 2
    ;;
esac
