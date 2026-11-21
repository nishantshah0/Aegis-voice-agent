# Status board

Every role (and its AI agent) updates its own section before opening a pull request. Claims themselves are GitHub issues. Keep it short. Newest first.

## Role 1 · Voice and agent

- **Doing:** 
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 2 · Platform and pharmacist

- **Doing:** 
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 3 · Red team and evals

- **Doing:** 
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 4 · Control layer (Nishant with Claude)

- **Doing:** `lib/contract/` with fakes, then the control layer, guard, in-memory store, seed and hammers
- **Done:** README, `docs/SPEC.md`, `docs/DESIGN.md`, `AGENTS.md`, the Next.js app, the GitHub coordination setup (issue templates, pull request template, release gate workflow), Entire (capture, Graph, Brain seeded with our rules, `docs/ENTIRE.md`)
- **Blocked:** 
- **Needs from others:** everyone: install Entire and run `entire login` (see `docs/ENTIRE.md`). Nishant: install Entire's GitHub App and run `entire brain connect`, so Trails and shared memories work.

---

## Contract change requests

Use the "Contract change request" issue template on GitHub. Don't edit `lib/contract/` directly.

## Open questions for humans

- Our teammate's OK to share his story, and in what words
- How many prize tracks one project can enter
- Whether Auth0's phone approval works on the free plan (Role 2, by Saturday 10 AM)
- Judging format: tables or a stage, and how long per team
