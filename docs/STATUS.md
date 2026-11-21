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

Role 1 runs from Nishant's machine from 1.2 on (MikeyDigit did 1.1).

- **Doing:** 1.8 handed off (Trail #21, branch `role-1/interrupt-silence`, stacked on 1.6's Trail #20). 1.5 part 2 (ElevenLabs out, pre-recorded fixed lines) waits on the ElevenLabs key and 2.6 hosting; 1.6's real median waits on a live model run.
- **Done:** 1.1 prompt and fixed lines (Trail #8). 1.2 typed agent loop: `createAgentDriver` in `lib/agent/driver.ts` (an `AgentDriver`: every caller line through `checkCallerLine` first, streamed text split into sentences and each through `guardSentence`, every tool call a `control.press`, refusals and runaway turns handed over through `escalate`), the 12 buttons as strict tools (`tools.ts`), the sentence splitter, the Claude adapter (`anthropic.ts`, `claude-sonnet-5-5`, automatic tool choice, server-side fallback on refusal), and a scripted model for tests. Sam's typed call passes on the real lock and on the fakes. 1.3: `driver.opening` (fixed greeting, or outbound opener then `send_code`), `driver.joinCall` for the daily check's calls, the side-effect question after a refill (`read_label`, then `sideEffectQuestion`), and the answer as a `note_for_pharmacist` side-effect note in Review. Trail #8's 3 review findings fixed (wrong-person line, refill-sync wording, every fixed line tested on the real guard). 1.4: `/phone` (ring and Answer, code text, transcript with blocked lines struck through and labelled, typed box, status), a pure reducer in `app/phone/state.ts` fed only by `/api/events`. 1.5 part 1: `lib/voice` (numbers as words after the guard, end of turn after 600 ms of silence, Chrome speech in with the mic off while the agent speaks, hold-to-talk, Chrome voice out) and a voice bar on the phone. 1.6: `driver.turnTimings(callId)` (first model text and first guarded sentence per caller line) and the phone's median turn time against the 1.2 s target. 1.8: tap to interrupt, and `driver.checkIn` ("Are you still there? Take your time.") after 8 s of silence.
- **Blocked:** a live call needs `ANTHROPIC_API_KEY` in the server's `.env` (a human sets it). Tests need no key.
- **Needs from others:** Role 4: ok for `@anthropic-ai/sdk` in `package.json`; a way for the model to get a prescription's `rx_id` on an inbound call (no button returns one); the label side-effect question from 1.1; S4 blocks SPEC's own outbound line "runs out Friday"; a side-effect note after the refill leaves the refill in Quick check (SPEC says Review). Role 2: wire `createAgentDriver` into `app/api/_lib/runtime.ts`, and add `POST /api/call/:id/answer`, `GET /api/call/:id/code`, `POST /api/call/:id/end` for the phone (REQUEST on the channel).

## Role 2 · Platform and pharmacist

- **Doing:** 2.8 handed off (Trail #12, branch `role-2/quick-check`, stacked on #10, #9, #7). Waiting on merges and on the humans for hosting (2.6) and the database (2.7).
- **Done:** 2.1 and the contract switch (merged). 2.5 decided: no phone push. 2.4 Auth0 sign-in and Approve/Deny (Trail #7). 2.2 demo reset and daily check (Trail #9). 2.3 Today view (Trail #10). 2.8 one-tap Quick check, and `GET /api/calls/:id/record` (Trail #12).
- **Blocked:** 2.6 hosting and 2.7 Postgres: parked by Nishant until the accounts are sorted.
- **Needs from others:** Role 1: the real AgentDriver for `app/api/_lib/runtime.ts`. Role 4: merge #7, #9, #10, #12 in order; answer the triage REQUEST about Sam's refill lane.

## Role 3 · Red team and evals

- **Doing:** 3.5 fixed suite, repeat scoring and persisted scoreboard (PR #30, claim #31, Trail #24), stacked on 3.3 runner review fixes (PR #26, Trail #17)
- **Done:** 3.1 first scenarios; 3.2 hijack driver (merged PR #7); 3.3 runner and scoring (merged PR #13); 3.4 hijack batch (merged PR #20, Trail #14)
- **Blocked:** live scoreboard needs the real driver and a model credential. Entire project visibility still blocks finding replies.
- **Needs from others:** Role 4 to review PR #26 before PR #30; Role 2 to wire `runFixedScenarioSuite` to the arena run route once the real driver lands.

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
