"""Open requests on the agent channel: who owes an answer, and who is waiting.

Reads messages as JSON lines on stdin ({"t", "u"(login), "b"(body), "urgent"?}) and
prints what ROLE (argv[1]) owes and waits on. Used by `scripts/channel.sh waiting`.
Keep this rule in sync with openItems() in scripts/board.html.

The rule (HUMAN, Sat 11:02): a REQUEST or OBJECT is answered only by a REPLY from the
asked role addressed to the asker. When the asked role is ALL or HUMAN, a REPLY or a
HUMAN message from anyone else, addressed to the asker, answers it. HANDOFF and MERGED
never answer a request. A BLOCKED is cleared by a HUMAN or REPLY from someone else,
addressed to the blocked role or ALL.
"""

import json
import re
import sys

HEAD = re.compile(r"^\[(?:ROLE-(\d)|HUMAN) · (?:([A-Z]+) → ([A-Z0-9-]+)|([A-Z0-9-]+))\] *(.*)$")


def parse(lines):
    msgs = []
    for line in lines:
        if not line.strip():
            continue
        m = json.loads(line)
        h = HEAD.match(m["b"].split("\n", 1)[0])
        if not h:
            continue
        human = not h.group(1) or h.group(1) == "0"
        to = (h.group(3) or h.group(4)).replace("ROLE-0", "HUMAN")
        msgs.append({
            "t": m["t"],
            "from": "HUMAN" if human else "ROLE-" + h.group(1),
            "type": "HUMAN" if human and not h.group(2) else h.group(2),
            "to": to,
            "s": h.group(5),
            "u": m.get("urgent", False),
        })
    return msgs


def answered(msgs, i):
    m = msgs[i]
    for r in msgs[i + 1:]:
        if m["type"] == "BLOCKED":
            if r["type"] in ("HUMAN", "REPLY") and r["to"] in (m["from"], "ALL") and r["from"] != m["from"]:
                return True
            continue
        if r["to"] != m["from"]:
            continue
        if m["to"] in ("ALL", "HUMAN"):
            if r["from"] != m["from"] and r["type"] in ("REPLY", "HUMAN"):
                return True
        elif r["from"] == m["to"] and r["type"] == "REPLY":
            return True
    return False


def open_items(msgs):
    return [m for i, m in enumerate(msgs) if m["type"] in ("REQUEST", "OBJECT", "BLOCKED") and not answered(msgs, i)]


def report(msgs, role):
    me = "ROLE-" + role
    items = sorted(open_items(msgs), key=lambda m: not m["u"])  # urgent first
    owe = [m for m in items if m["type"] != "BLOCKED" and m["to"] in (me, "ALL") and m["from"] != me]
    wait = [m for m in items if m["from"] == me]
    out = []
    for title, group in (("You owe an answer (post a REPLY addressed to the role that asked):", owe), ("You are waiting on:", wait)):
        out.append(title)
        for m in group:
            out.append("  %s  %s%s %s → %s: %s" % (m["t"].replace("T", " ")[:16], "URGENT " if m["u"] else "", m["type"], m["from"], m["to"], m["s"]))
        if not group:
            out.append("  nothing")
        out.append("")
    return "\n".join(out)


if __name__ == "__main__":
    print(report(parse(sys.stdin), sys.argv[1]))
