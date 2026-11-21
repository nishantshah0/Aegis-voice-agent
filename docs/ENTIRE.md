# How we build with Entire

Entire captures every AI agent session, links it to the commit it produced, maps the codebase for agents, and remembers the team's decisions. We use all four of its core features. This is also our entry for **[MLH] Best Use of Entire**.

**The story:** our product puts a lock around an AI pharmacist. Entire put a lock around our AI developers. Brain remembers the rules (the AI only acts through the 12 buttons, never edit the contract directly), so every teammate's agent recalls them before it edits.

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
   ```
5. Sign in, for Trails and shared Brain memories: `entire login`.
6. **Start a new agent session.** Agents only load Entire's hooks when a session starts.

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
| **Claim and hand off** | `entire trail create --title "..."` on your task branch | A Trail replaces the issue and pull request: intent, branch, agent review, findings and approval in one place |
| **Review** | `entire trail show`, `entire trail finding ...`, `entire trail approve` | Review agents score each push against the Trail's intent. Our release gate must pass too. |
| **Merge** | `entire trail merge` | Integrated by the coordinating agent (Role 4) |
| **Sleep-shift handover** | `entire session resume <branch>` | The next person's agent picks up exactly where the last one stopped |
| **After a decision** | `entire brain remember "<rule>" --kind decision --path project.<area>.<topic>` | Everyone's agent recalls it from then on |
| **Explain a commit** | `entire checkpoint explain <id>` | The prompts, tool calls and diff behind any commit |

If you don't have an Entire account yet, use the GitHub fallback: the "Claim a task" issue and a pull request with the template. Same rules either way.

---

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

The prize asks for measurable token efficiency. Entire's "up to 71%" is its own figure, so we measure ours:

1. Pick three real tasks from our build, for example "find where rule 4b is enforced", "add a field to the Sam seed", "which code emits press events?"
2. Run each in a **fresh** agent session twice: once told not to use Entire Graph, once told to use it.
3. Read the token usage Entire records for each session (shown with the checkpoint on entire.com, or with `entire checkpoint explain`).
4. Record the results in `results/entire-tokens.md`: task, tokens without Graph, tokens with Graph, and the difference.

`entire graph stats` reports a **modelled** balance, not measured savings. Label it that way if we ever show it.

---

## What we show judges

- The README's "Built with Entire" section: Trails merged, checkpoints captured, the share of lines written by agents versus humans (from Entire's line attribution), and the measured token table. **Real numbers from the repo only.**
- A screenshot of `entire brain viz`, the team's memory graph.
- One 20-second clip for the video: an agent recalls "never add a shortcut, even for the demo" from Brain before editing the control layer.
- The sleep-shift handover: one agent resuming another's session.
