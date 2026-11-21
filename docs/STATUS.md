# Status board

Every role (and its AI agent) updates its own section when it hands off. Claims are a CLAIM message on the agent channel plus an Entire Trail. Keep it short, newest first.

## Who's taking which role

Write your name and your AI tool next to one role, then tell your agent the role number.

| Role | Taken by | AI tool | First task |
|---|---|---|---|
| 1 · Voice and agent | | | 1.1 prompt and fixed lines |
| 2 · Platform and pharmacist | Nishant | Claude Code | 2.1 API skeleton and event stream |
| 3 · Red team and evals | | | 3.1 scenario format and first 10 scenarios |
| 4 · The lock, and integrator | | | 4.2 store and seed, right after task 0 |


## Next up

The planning is finished. These are the first things to do, in order:

1. **Rotate the ElevenLabs key** (it was exposed during planning) and put the new one only in `.env`.
2. **Everyone:** set up Entire with the message in `docs/ENTIRE.md`, then run `scripts/entire-check.sh` until it's all ticks. On Nishant's laptop, turn uploads back on in a new session: `entire configure --checkpoint-push-policy automatic`.
3. **Take a role** in the table above.
4. **Task 0:** build `lib/contract/` (types and fakes, `docs/DESIGN.md` section 3) on branch `control/contract`, Entire Trail #1. Every role's real code depends on it.
5. **Start the agent loops** (`docs/AUTONOMY.md`). Roles 1 to 3 can start their first task before task 0 lands.
6. **Role 2, by Saturday 10 AM:** check whether Auth0's phone approval works on the free plan.
7. **Someone:** visit the Sun Life table, and ask the organisers about the judging format and how many prize tracks one project can enter.
8. **Noon checkpoint:** Sam's refill, typed, start to finish, three times in a row. Then record a backup video.

Not doing: Entire's hosted review agents (they need billing). Maybe later: a GitHub Projects job board, with every task in `docs/TASKS.md` as a card.

## Role 1 · Voice and agent

- **Doing:** 1.1 prompt and fixed lines (see `docs/TASKS.md`)
- **Done:** 
- **Blocked:** 
- **Needs from others:** 

## Role 2 · Platform and pharmacist

- **Doing:** contract switch handed off (Trail #5, branch `role-2/contract-switch`). Next: 2.5 Auth0 phone-approval check (by Saturday 10 AM, needs a human for the Auth0 tenant), then 2.2 once 4.2 lands.
- **Done:** 2.1 API skeleton and event stream (merged). Contract switch: event types, driver, store and `Approver` come from `lib/contract/`; the API runs on `createFakes(emit)` in `app/api/_lib/runtime.ts`; the demo clock is on the Store; decide calls `store.decide` and emits `queue` (still 401 until 2.4).
- **Blocked:** 
- **Needs from others:** Role 4: swap `lib/store/memory.ts` into `app/api/_lib/runtime.ts` when 4.2 lands (or I will). Role 1: the real `AgentDriver` for the same file.

## Role 3 · Red team and evals

- **Doing:** 3.2 hijack agent once task 0 lands
- **Done:** 3.1 scenario format and first 10 JSON cards; replay is task 3.3
- **Blocked:** task 0 contract has not landed; Entire Trails are not visible to this login, so claim issue #3 tracks the work
- **Needs from others:** Role 4 to confirm fixture and prescription IDs for Sam, P4 and P7

## Role 4 · The lock

- **Doing:** 4.3 control layer (12 buttons, core rules, cards engine, lanes), then 4.4 guard and 4.5 hammers
- **Done:** 4.2 in-memory store (`lib/store/memory.ts`, `getStore()`, sha256 hash chain, `findBrokenLink`) and seed (`lib/seed`, 8 patients, `IDS`). Task 0 contract (`lib/contract/`). Task 0 setup: README, `docs/SPEC.md`, `docs/DESIGN.md`, `AGENTS.md`, the Next.js app, the GitHub coordination setup (issue templates, pull request template, release gate workflow), Entire (capture, Graph, Brain seeded with our rules, `docs/ENTIRE.md`)
- **Blocked:** Entire Trails aren't visible from PS12007, so no Trails for Role 4 yet
- **Needs from others:** everyone: install Entire and run `entire login` (see `docs/ENTIRE.md`). Entire's repo onboarding, Trails and shared Brain are already set up.

---

## Contract change requests

Use the "Contract change request" issue template on GitHub. Don't edit `lib/contract/` directly.

## Open questions for humans

- Our teammate's OK to share his story, and in what words
- How many prize tracks one project can enter
- Whether Auth0's phone approval works on the free plan (Role 2, by Saturday 10 AM)
- Judging format: tables or a stage, and how long per team
