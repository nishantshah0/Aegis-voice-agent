# Status board

Every role (and its AI agent) updates its own section when it hands off. Claims are a CLAIM message on the agent channel plus an Entire Trail. Keep it short, newest first.

## Who's taking which role

Write your name and your AI tool next to one role, then tell your agent the role number.

| Role | Taken by | AI tool | First task |
|---|---|---|---|
| 1 · Voice and agent | | | 1.1 prompt and fixed lines |
| 2 · Platform and pharmacist | | | 2.1 API skeleton and event stream |
| 3 · Red team and evals | | | 3.1 scenario format and first 10 scenarios |
| 4 · The lock, and integrator | | | 4.2 store and seed, right after task 0 |


## Role 1 · Voice and agent

- **Doing:** 1.1 prompt and fixed lines (see `docs/TASKS.md`)
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 2 · Platform and pharmacist

- **Doing:** 2.1 API skeleton and event stream
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 3 · Red team and evals

- **Doing:** 3.1 scenario format and first 10 scenarios
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 4 · The lock

- **Doing:** 4.2 in-memory store and seed data, then the control layer, guard and hammers
- **Done:** task 0 setup: README, `docs/SPEC.md`, `docs/DESIGN.md`, `AGENTS.md`, the Next.js app, the GitHub coordination setup (issue templates, pull request template, release gate workflow), Entire (capture, Graph, Brain seeded with our rules, `docs/ENTIRE.md`)
- **Blocked:** 
- **Needs from others:** everyone: install Entire and run `entire login` (see `docs/ENTIRE.md`). Entire's repo onboarding, Trails and shared Brain are already set up.

---

## Contract change requests

Use the "Contract change request" issue template on GitHub. Don't edit `lib/contract/` directly.

## Open questions for humans

- Our teammate's OK to share his story, and in what words
- How many prize tracks one project can enter
- Whether Auth0's phone approval works on the free plan (Role 2, by Saturday 10 AM)
- Judging format: tables or a stage, and how long per team
