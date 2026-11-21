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
6. ~~**Role 2, by Saturday 10 AM:** check whether Auth0's phone approval works on the free plan.~~ Done: no phone push; approval is the Approve button on the Today page.
7. **Someone:** visit the Sun Life table, and ask the organisers about the judging format and how many prize tracks one project can enter.
8. **Noon checkpoint:** Sam's refill, typed, start to finish, three times in a row. Then record a backup video.

Not doing: Entire's hosted review agents (they need billing). Maybe later: a GitHub Projects job board, with every task in `docs/TASKS.md` as a card.

## Role 1 · Voice and agent

- **Doing:** 1.2 typed agent loop next (needs `ANTHROPIC_API_KEY` in `.env`, which a human sets)
- **Done:** 1.1 prompt and fixed lines on `role-1/prompt-and-lines` (Trail #8): `lib/agent/prompt.ts` (per call, no list of forbidden things, the three firm things from SPEC Part 2) and `lib/agent/lines.ts` (greeting, verification ask, code line, holding line, outbound opener and wrong-person variant, refill-sync offer, side-effect acknowledgement, missed-doses line, `sideEffectQuestion` built from label text). 36 tests.
- **Blocked:** `entire trail ready` and `entire trail list` fail for this login (`project gh/nishantshah0 ... not visible`), same as Role 3. Trail #8 exists and shows under `entire trail list --mine`, so the fix is an Entire project grant: `entire project grant add <project> github:MikeyDigit --role writer`.
- **Needs from others:** Role 4: the seeded `labelText` carries directions only, so SPEC 126's side-effect question cannot quote any side effect (REQUEST on the channel). My code asks the question without naming any and invents nothing; a decision is needed on whether to add real label side-effect text or correct the SPEC example.

## Role 2 · Platform and pharmacist

- **Doing:** 2.3 handed off (Trail #10, branch `role-2/today-view`, stacked on 2.2's Trail #9 and 2.4's Trail #7). Next: 2.6 hosting.
- **Done:** 2.1 and the contract switch (merged). 2.5 decided: no phone push. 2.4 Auth0 sign-in and Approve/Deny (Trail #7). 2.2 demo reset and daily check (Trail #9). 2.3 Today view: lane totals, Review first, full item detail, phone status on approve (Trail #10).
- **Blocked:** 
- **Needs from others:** Role 1: the real AgentDriver for `app/api/_lib/runtime.ts`, so a live call can put Sam's refill in the queue (today only tests do). Role 4: see the triage REQUEST about Sam's refill lane.

## Role 3 · Red team and evals

- **Doing:** urgent 3.3 review fixes on `role-3/runner-review-fixes` (claim #22, Trail #17): no caller-line backfill, failed checks for skipped safety, outbound opener and rule 7 coverage
- **Done:** 3.1 first scenarios; 3.2 hijack driver (merged PR #7); 3.3 runner and scoring (merged PR #13); 3.4 hijack batch (merged PR #20, Trail #14)
- **Blocked:** S3 written-out quantity gap #10 is outside Role 3's folder; Entire still cannot list findings on Trails #6 and #11 or comments on Trail #2 because the project is not visible to this login
- **Needs from others:** Role 4 to fix guard gap #10 through the lock approval process; Role 2 to wire the batch API and persist its result before emitting a score

## Role 4 · The lock

- **Doing:** integration (4.7) while 4.3 to 4.5 wait on a HUMAN ok; then 4.6 stage view
- **Done:** 4.5 hammers on `role-4/hammers`: depth 3 (40,878 sequences) and 10,000 random, 0 rules broken (results/hammer-latest.json). 4.4 guard on `role-4/guard` (waits on a HUMAN ok): `lib/guard`, 39 tests. 4.3 control layer on `role-4/control` (waits on a HUMAN ok): `lib/control`, 77 tests. 4.2 in-memory store (`lib/store/memory.ts`, `getStore()`, sha256 hash chain, `findBrokenLink`) and seed (`lib/seed`, 8 patients, `IDS`). Task 0 contract (`lib/contract/`). Task 0 setup: README, `docs/SPEC.md`, `docs/DESIGN.md`, `AGENTS.md`, the Next.js app, the GitHub coordination setup (issue templates, pull request template, release gate workflow), Entire (capture, Graph, Brain seeded with our rules, `docs/ENTIRE.md`)
- **Blocked:** Entire Trails aren't visible from PS12007, so no Trails for Role 4 yet
- **Needs from others:** everyone: install Entire and run `entire login` (see `docs/ENTIRE.md`). Entire's repo onboarding, Trails and shared Brain are already set up.

---

## Contract change requests

Use the "Contract change request" issue template on GitHub. Don't edit `lib/contract/` directly.

## Open questions for humans

- Our teammate's OK to share his story, and in what words
- How many prize tracks one project can enter
- Judging format: tables or a stage, and how long per team
