# How we build with Entire

Entire captures every AI agent session, links it to the commit it produced, maps the codebase for agents, and remembers the team's decisions. We use all four of its core features. This is also our entry for **[MLH] Best Use of Entire**.

The workflow below is the team plan. Trails, session capture, Graph and Brain are in use. The product's overnight Trail loop, Rules tab and `entire why` export are still planned; see [CURRENT.md](CURRENT.md).

**The story:** our product puts a lock around an AI pharmacist. Entire put a lock around our AI developers. Brain remembers the rules (the AI only acts through the 12 buttons, never edit the contract directly), so every teammate's agent recalls them before it edits.

## Entire inside the product, not just around it

The strongest Entire projects make Entire part of what they build. Ours does it twice:

1. **The overnight fix loop runs on Entire Trails.** When our AI attacker finds a gap in Refill Guard, its agent opens a **Trail** with the failing scenario and a proposed fix. `entire review` (several reviewer agents, then a judge) and our release gate check it, a person **approves it on Entire**, and only then does it merge. Our pitch line, *"the AI proposes, a person approves, the gate checks,"* is literally an Entire Trail.
2. **The console's Rules and checks tab shows `entire why` for every rule.** Click rule 4b and see the commit, prompt, agent session and approval that created it. Refill Guard audits the AI pharmacist, and Entire audits the AI that built the auditor. (A script saves `entire why --json` output for each rule file to `results/why/`, so the hosted app doesn't need the CLI.)

---

## One-time setup for each teammate (about 5 minutes)

1. Install the CLI. On macOS without Homebrew, run the official script:
   ```bash
   curl -fsSL https://entire.com/install.sh | bash
   ```
   Then add `~/.local/bin` to your PATH if the installer asks.
2. `git pull` this repo. Entire's shared settings are already committed (`.entire/settings.json`, `.claude/settings.json`, `.entire/agent-guide.md`).
3. Enable capture for **your** AI tool. Claude Code is already set up in the repo. For other tools:
   ```bash
   entire enable --agent cursor        # or codex, copilot-cli, opencode
   ```
4. Install the plugins:
   ```bash
   entire plugin install graph
   entire plugin install brain
   entire brain setup --no-backfill --no-daemon
   entire brain connect
   ```
5. Sign in, for Trails and shared Brain memories: `entire login`.
6. **Start a new agent session.** Agents only load Entire's hooks when a session starts.
7. **Check everything:** `scripts/entire-check.sh` prints a tick or a cross for each piece, and how to fix a cross.

**Important:** if you use Claude Code, install Entire before opening a session in this repo. The committed hooks call `entire`, and they'll error if it isn't installed.

---

## Where transcripts go (privacy)

Session transcripts go **only** to the private repo `nishantshah0/namereserve-sessions`, never to this repo, which may go public. It's set in `.entire/settings.json`. Entire's secret redaction is best effort, so:
- never paste keys or real people's details into an agent chat
- before a demo, check a checkpoint with `entire checkpoint explain <id>`

---

## The workflow

| Step | Command | What it gives us |
|---|---|---|
| **Before a task** | `entire brain brief "<task>"` and `entire brain recall "<question>"` | The team's rules and past decisions, before the agent edits anything |
| **Finding code** | `entire graph query "<what you need>"` | A ranked map of the right files, instead of the agent blindly searching |
| **Before changing shared code** | `entire graph impact <symbol>` | The blast radius, for example everyone who builds against a contract type |
| **While working** | (automatic) | Every session is captured. Every commit gets an `Entire-Checkpoint` trailer linking it to its prompts. |
| **Claim and hand off** | `entire trail create --title "..."` on your task branch; CLAIM on issue #1; pull request when requested or using GitHub review | The Trail holds intent and findings; the channel shares ownership; a PR shows the diff and checks |
| **Review** | Agents review each other with **findings**: `entire trail finding add` on the other role's Trail. Then `entire review` (multi-agent review using our own agents on our own machines), the release gate, and `entire trail approve` by Role 4 or a person. | Review agents score each push against the Trail's intent. Our release gate must pass too. |
| **Merge** | `entire trail merge` | Integrated by the coordinating agent (Role 4) |
| **Sleep-shift handover** | `entire session resume <branch>` | The next person's agent picks up exactly where the last one stopped |
| **After a decision** | `entire brain remember "<rule>" --kind decision --path project.<area>.<topic>` | Everyone's agent recalls it from then on |
| **Explain a commit** | `entire checkpoint explain <id>` | The prompts, tool calls and diff behind any commit |
| **Explain a line** | `entire why <file>:<line>` | The commit, checkpoint, prompt and session behind one line |
| **Before asking another agent** | `entire search "<question>" --compact` | Finds past sessions and checkpoints that already solved it |
| **Morning handover** | `entire dispatch` | A summary of overnight agent work, posted to the agent channel |
| **Who built what** | `entire experts <folder>`, `entire blame <file>` | Which agents, skills and tools touched each part of the code |

If you don't have an Entire account yet, use the GitHub fallback: a "Claim a task" issue and a pull request with the template. Cross-role work should also record its files in a claim issue, so other editors can avoid overlap.

---

## Trails on a personal repo: what teammates can and can't see

Our repo belongs to a personal GitHub account, so Entire's project for it (`gh/nishantshah0`) has one member: the owner. Entire copies that from GitHub and won't take manual grants. We're not moving to a GitHub organization for a hackathon, so:

| Teammates can | Teammates can't |
|---|---|
| Create Trails on their branches (`entire trail create`) | See the full Trails list on entire.com or with `entire trail list` |
| Open any Trail by number: `entire trail show <n> --project gh/nishantshah0` | |
| Add and answer findings, mark ready, get recorded | |

**The team's Trail list is the channel:** every CLAIM and HANDOFF includes `Trail #<n>`, and `scripts/channel.sh trails` lists every Trail mentioned, newest first. `scripts/entire-check.sh` accepts "can open Trails" as a pass.

## Entire's hosted review agents: we don't use them

The Agents page on entire.com offers hosted reviewers (Code review, Security review, Slop). They need paid billing, because free credits are paused for new accounts. **We don't add them.** Our reviews come from our own agents' findings, `entire review` on our machines, and the release gate. They aren't required for the prize.

## What Brain already knows

Seeded on Saturday from `docs/DECISIONS.md`:

| Kind | Memory |
|---|---|
| Invariant | The AI agent only acts through the 12 buttons, and every press goes through the control layer. No shortcuts, even for the demo. |
| Invariant | The AI agent only speaks through `guardSentence` (S1 to S4). |
| Invariant | Everything is a call: one `AgentDriver` for patients, scenarios and attacks. |
| Convention | Never edit `lib/contract/` directly. Use a contract change request. |
| Decision | Rule 4b allows a controlled refill up to 3 days early. |
| Decision | Triage lanes are chosen in code, never by the AI. |
| Decision | The AI's self-reported confidence is shown, never used. |
| Invariant | Keys only in `.env`, made-up patients only, no invented numbers. |
| Convention | Never change a test and the code it tests in the same step. |
| Decision | Transcripts go only to the private sessions repo. |

Test it: `entire brain recall "can I bypass the control layer for the demo?"`

Memories stay on the machine that made them until someone runs `entire brain connect` (needs `entire login`). Role 4 connects first, so everyone shares one Brain.

---

## Measuring token efficiency (real numbers only)

The prize asks for measurable token efficiency. Entire's "up to 71%" is its own figure, so we measure ours with Entire's own tools:

1. **Across the whole build:** `entire tokens profile --all` adds up token usage across every committed checkpoint. Run it Saturday evening and Sunday morning, and save both to `results/entire-tokens-profile-*.json`.
2. **Per session:** `entire session tokens <session-id>` shows one session's usage and Entire's recommendations. Record what we changed because of them.
3. **Graph versus no Graph:** pick three real tasks (for example "find where rule 4b is enforced", "add a field to Sam's seed", "which code emits press events?"). Run each in a fresh session twice, once told not to use Graph and once told to use it, then compare with `entire session tokens`. Record the results in `results/entire-tokens.md`.

`entire graph stats` reports a **modelled** balance, not measured savings. Label it that way if it's ever shown. These are labs commands, so check the flags with `entire <command> --help` on the day.

## What we show judges

- The README's "Built with Entire" section: Trails merged, checkpoints captured, findings resolved between agents, fixes approved on Trails, and the measured token table. **Real numbers from the repo only.** Entire doesn't attribute individual lines to AI or humans, so never claim a percentage of AI-written lines.
- The product moment: an overnight gap, its fix Trail, the multi-agent review, and the human approval, all on Entire.
- The console's `entire why` panel on a rule.
- The morning dispatch, as the "what our agents did while we slept" screenshot.
- A screenshot of `entire brain viz`, the team's memory graph.
- One 20-second clip for the video: an agent recalls "never add a shortcut, even for the demo" from Brain before editing the control layer.
- The sleep-shift handover: one agent resuming another's session.
