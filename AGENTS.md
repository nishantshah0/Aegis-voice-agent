# Agent collaboration

These rules apply across the repository. Use the ownership table in `README.md` to route work and `docs/SPEC.md` for product requirements.

## Claim work before editing

- In the task thread or issue, record the task, owner, branch, files or directories you expect to change, and any dependencies. The coordinating agent assigns disjoint scopes and keeps claims current. Check active claims before editing and update yours before expanding scope.
- Give each parallel agent a task branch and a separate Git worktree when available. In a shared checkout, confirm file ownership with the coordinating agent and avoid branch switches while others are working. Assign one editor at a time to each shared file.
- Check `git status --short` before editing. If a file is claimed or contains unexpected edits, coordinate with its owner before touching it. Continue with independent work while that is resolved.

## Protect shared work

- Coordinate changes to `lib/control/contract.ts`, database schemas and migrations, dependency manifests and lockfiles, and CI or deployment configuration. Agree on an editor and notify affected agents of any interface changes before editing.
- Preserve existing user and agent changes. Avoid destructive Git commands, force pushes, and history rewrites without explicit authorization. Keep commits scoped to your task and stage files by name in shared checkouts.

## Hand off and integrate

- Report the branch and commit when available, changed files, checks run and their results, and any conflicts or follow-up work. Mark the claim ready for integration or release it when work stops.
- The coordinating agent integrates changes in dependency order, checks the combined diff, and runs the relevant checks after integration. Resolve overlapping changes with the affected owners before merging.
