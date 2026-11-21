# Setup: from nothing to a running agent

For a teammate joining the build, and the AI agent helping them. It's written for **Role 1 (Voice and agent)**. Other roles swap the number 1 for theirs.

**Agent reading this:** work through the steps in order. Run each check and fix a failure before moving on. Steps marked **HUMAN** need your person at the keyboard (a browser sign-in or a secret). Ask them, wait, then check it worked. Your human asking you to follow this file is the go-ahead for the Entire setup commands in steps 4 and 5, and only those. Every other rule in `AGENTS.md` and `CLAUDE.md` still applies.

**Never** ask your human to paste a key, password or token into the chat, and never print `.env`. This chat is recorded by Entire.

---

## 1. Access (HUMAN, 2 minutes)

You need write access to two private repos. The owner has already sent the invites.

1. Sign in to GitHub as **your own account** (for Role 1, `MikeyDigit`).
2. Accept both invites:
   - https://github.com/nishantshah0/namereserve/invitations
   - https://github.com/nishantshah0/namereserve-sessions/invitations

**Check:** both repos open in the browser while you're signed in. If you get a 404, the invite went to a different account: ask Nishant on the channel or by DM.

## 2. Tools

| Tool | Check | Install |
|---|---|---|
| git | `git --version` | macOS: `xcode-select --install` |
| Node 22 or newer | `node -v` | https://nodejs.org (LTS) |
| Python 3 | `python3 -c "import sys"` (or `python` / `py` on Windows) | https://python.org. Used by `scripts/channel.sh`. |
| GitHub CLI | `gh --version` | https://cli.github.com |
| Claude Code | `claude --version` | https://claude.com/claude-code |
| Entire CLI | `entire version` | `curl -fsSL https://entire.com/install.sh \| bash`, then put `~/.local/bin` on your PATH |

**On Windows, use WSL (Ubuntu) for everything:** clone the repo inside WSL, install the tools there and open Claude Code from there. Entire's installer and git hooks are shell scripts. If `entire` isn't on the PATH of the shell git uses for hooks, the hook skips silently and **your commits never get linked to your sessions**.

**Install Entire before you open Claude Code in this repo.** The repo's Claude Code hooks call `entire`.

## 3. Sign in (HUMAN, 3 minutes)

Use the **same GitHub account** for both. Most setup problems so far came from signing in to Entire with Google, or to `gh` with a different account.

```bash
gh auth login          # GitHub.com, HTTPS, log in with a web browser
entire login           # choose GitHub, not Google
```

**Check:**

```bash
gh auth status                                   # shows your account
gh repo view nishantshah0/namereserve >/dev/null && echo "repo ok"
entire auth status                               # "Logged in", with your GitHub account
```

If `entire auth status` shows the wrong account: `entire logout`, then `entire login` again and choose GitHub.

## 4. Get the code

```bash
gh repo clone nishantshah0/namereserve
cd namereserve
npm install
echo 1 > .agent-role        # your role number. Git ignores this file.
```

`.agent-role` lets the repo's hook hand your agent every new channel message for your role at the start of each prompt.

## 5. Turn on Entire in this clone

```bash
entire enable --agent claude-code     # or cursor, codex, copilot-cli, opencode
entire plugin install graph
entire plugin install brain
entire brain setup --no-backfill --no-daemon
entire brain connect
```

Keep `--no-backfill --no-daemon`: the other modes spend tokens in the background.

**Check:** `scripts/entire-check.sh`. Every line should be a tick. For Trails, "Can open and create Trails" is a pass: teammates can't list Trails on a personal repo, and that's expected (see `docs/ENTIRE.md`).

## 6. Keys in `.env` (HUMAN)

```bash
cp .env.example .env
```

Role 1 needs these. Get them from Nishant **by private DM**, never on the channel, in the repo or in an AI chat. Then paste them into `.env` yourself:

| Key | For |
|---|---|
| `ANTHROPIC_API_KEY` | The agent (Claude) and the safety checks |
| `ELEVENLABS_API_KEY` | The agent's voice |

Speech in uses Chrome's built-in recognition, so it needs no key. Leave the other lines empty unless your role's tasks need them.

**Agent check, without printing values:**

```bash
for k in ANTHROPIC_API_KEY ELEVENLABS_API_KEY; do grep -q "^$k=." .env && echo "$k set" || echo "$k MISSING"; done
```

## 7. Make sure the project builds

```bash
npm run typecheck && npm run lint && npm test
npm run dev                 # then open http://localhost:3000 and stop it with Ctrl-C
```

All three checks must pass on a fresh clone. If one fails, post BLOCKED on the channel with the output instead of fixing other roles' code.

## 8. Start a NEW agent session (HUMAN)

Quit Claude Code completely and open a new session in the repo folder. Agents only load Entire's hooks when a session starts, so a session that was already open before step 5 is never recorded.

**Check that recording works:** in the new session, `entire status` shows capture enabled and an active session. After your first real commit:

```bash
git log -1 --format=%B | grep Entire-Checkpoint
```

It must print a line. If it doesn't, see "Commits aren't linked" below.

## 9. Say hello and start the loop

Read `AGENTS.md`, `agents/role-1.md`, `docs/AUTONOMY.md` (especially "Posting so the board reads right"), `docs/TASKS.md` (Role 1 section) and `docs/DESIGN.md` sections 2 and 3. Then:

```bash
scripts/channel.sh stopped || echo "not stopped"
scripts/channel.sh read 20
scripts/channel.sh say 1 STATUS ALL "1.1: Role 1 online, starting the prompt and fixed lines"
```

Then the human starts the autonomous loop in Claude Code:

```
/loop Follow agents/role-1.md. Run one cycle of the loop in docs/AUTONOMY.md, then wait for the next cycle.
```

## What Role 1 builds on

| You need | Where it is |
|---|---|
| Your tasks, in order | `docs/TASKS.md`, Role 1: 1.1 prompt and fixed lines, 1.2 typed agent loop, 1.3 outbound call and side effects, 1.4 phone page, 1.5 voice, 1.6 turn timing |
| The interface you implement | `AgentDriver` in `lib/contract/driver.ts` |
| The 12 buttons (your tools) | `lib/contract/buttons.ts` |
| Speech and caller-line checks you must call | `guardSentence` and `checkCallerLine` in `lib/contract/guard.ts` |
| Events the phone page listens to | `lib/contract/events.ts`, streamed on `/api/events` |
| Fake data to build against now | `lib/contract/fakes.ts` (Sam's call) |
| Model ids and API rules | `CLAUDE.md`, "Using the Claude API in the product" |
| Other roles' merged work | `scripts/channel.sh read 30`, `docs/STATUS.md`, `docs/DECISIONS.md` |

Your folders are `lib/agent/` (except `hijack.ts`), `lib/voice/` and `app/phone/`. Build against `lib/contract/` and the fakes, never against another role's folder.

## Troubleshooting

| Problem | Fix |
|---|---|
| `gh repo view` says not found | The invite isn't accepted, or `gh` is signed in as another account. `gh auth status`, then `gh auth login` as your own account. |
| `entire-check.sh`: not signed in, or Brain not shared | `entire logout`, then `entire login` and choose **GitHub**. Then `entire brain connect`. |
| Your recordings don't upload | Accept the `namereserve-sessions` invite (step 1). |
| **Commits aren't linked** (no `Entire-Checkpoint` line) | 1. Start a new agent session (step 8). 2. Run `sh -c 'command -v entire'`. If it prints nothing, git's hook can't find Entire: add `~/.local/bin` to your PATH in `~/.profile` too, or use WSL on Windows. 3. Run `entire doctor`. 4. Commit from inside the recorded agent session, not from another terminal or app. |
| `channel.sh` says it needs Python 3 | Install Python 3. On Windows, the `python3` command can be a Microsoft Store stub that doesn't run. |
| The Trails list is empty | Expected for teammates. Use `scripts/channel.sh trails`, and open one with `entire trail show <n> --project gh/nishantshah0`. |
| A check fails in code you don't own | Post BLOCKED on the channel with the output. Don't fix another role's folder. |

When every step passes, post one line in the human channel or to Nishant: "Role 1 set up, recording on, loop started."
