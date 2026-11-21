# Rules for AI coding agents on Refill Guard

Read this first, every session. It applies to every AI tool the team uses: Claude Code, Cursor, Codex, Copilot and others. Product requirements are in `docs/SPEC.md`. Who owns what and how the parts connect is in `docs/DESIGN.md` and the ownership table at the bottom of this file.

**Coordinating agent:** Claude on Nishant's laptop, which integrates branches into `main`. If the team picks someone else, record it in `docs/DECISIONS.md`.

## Before you write code

1. `git pull`, then check `git status --short`.
2. Read `docs/STATUS.md`. Find your person's section, and check whether anyone needs something from you.
3. Read `docs/DESIGN.md`, sections 2 and 3. Know which folder you own and which interfaces you touch.
4. Read the types in `lib/contract/`. Build against them, never against another person's code.
5. Read `docs/DECISIONS.md`, so you don't undo something the team already decided.
6. Claim your work (next section).

## Agent collaboration

### Claim work before editing

- In the task thread or issue (a GitHub issue, or your section of `docs/STATUS.md`), record the task, owner, branch, files or directories you expect to change, and any dependencies. The coordinating agent assigns disjoint scopes and keeps claims current. Check active claims before editing and update yours before expanding scope.
- Give each parallel agent a task branch and a separate Git worktree when available. In a shared checkout, confirm file ownership with the coordinating agent and avoid branch switches while others are working. Assign one editor at a time to each shared file.
- Check `git status --short` before editing. If a file is claimed or contains unexpected edits, coordinate with its owner before touching it. Continue with independent work while that is resolved.

### Protect shared work

- Coordinate changes to `lib/contract/`, database schemas and migrations, dependency manifests and lockfiles, and CI or deployment configuration. Agree on an editor and notify affected agents of any interface changes before editing. Propose contract changes in `docs/STATUS.md` under "Contract change requests".
- Preserve existing user and agent changes. Avoid destructive Git commands, force pushes, and history rewrites without explicit authorization. Keep commits scoped to your task and stage files by name in shared checkouts.

### Hand off and integrate

- Report the branch and commit when available, changed files, checks run and their results, and any conflicts or follow-up work. Mark the claim ready for integration or release it when work stops.
- The coordinating agent integrates changes in dependency order, checks the combined diff, and runs the relevant checks after integration. Resolve overlapping changes with the affected owners before merging.

## While you work

- **Only edit folders your person owns** (table below, and `docs/DESIGN.md` section 2). If you need a change somewhere else, don't make it. Add a request under that person's "Needs from others" in `docs/STATUS.md`, or open a GitHub issue, and use the fake from `lib/contract/` meanwhile.
- **Never change a test and the code it tests in the same step.**
- **The lock is sacred.** Nothing may let the AI act except through the 12 buttons and the control layer, or speak except through `guardSentence`. Don't add shortcuts, even "just for the demo".
- **Keys only in `.env`,** which is git-ignored. Never paste a key into code, a test, a doc or a commit.
- **Made-up patients only.** Phone numbers use 555-01xx. No real people's details anywhere.
- **No invented numbers.** Anything shown as a result must come from a real run in `results/`.
- Keep functions small and code plain. No new frameworks without a decision in `docs/DECISIONS.md`.

## Before you hand off

1. Run `npm run typecheck`, `npm test` and `npm run lint`. Don't say something works until they pass.
2. If you touched the control layer or the guard, run `npm run hammer` too. It must report 0 rules broken.
3. Update your section in `docs/STATUS.md`: Doing, Done, Blocked, Needs from others.
4. Commit small, with a clear message, on your task branch, and push the branch. Hand off as described above. Never push a broken build to `main`.
5. If you made a decision others should know about, add one line to `docs/DECISIONS.md`.

## Owners

| Person | Owns |
|---|---|
| 1 · Voice and agent | `lib/agent/` (except `hijack.ts`), `lib/voice/`, the phone page's audio |
| 2 · Platform | `app/api/`, `lib/events/`, `lib/auth/`, `lib/store/postgres.ts`, hosting |
| 3 · Red team and evals | `lib/agent/hijack.ts`, `lib/arena/`, `scenarios/` |
| 4 · Design and pitch | `app/` pages (phone, stage, console), styles, `docs/pitch/` |
| Claude (coordinating agent) | `lib/contract/`, `lib/control/`, `lib/guard/`, `lib/store/memory.ts`, `lib/seed/`, `scripts/` |

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
