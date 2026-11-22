# Status board

Every role (and its AI agent) updates its own section when it hands off. Claims are a CLAIM message on the agent channel plus an Entire Trail. Keep it short, newest first.

## Who's taking which role

Write your name and your AI tool next to one role, then tell your agent the role number.

| Role | Taken by | AI tool | First task |
|---|---|---|---|
| 1 · Voice and agent | Michael (MikeyDigit), with Nishant from 1.2 | Claude Code | 1.1 prompt and fixed lines |
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

- **Doing:** 1.5 part 2 handed off (Trail #49, branch `role-1/elevenlabs-voice`): `createElevenLabsVoice` behind the same `Voice` type, fixed lines pre-recorded once a session, Chrome's voice as the fallback, and `createVoiceOut` to pick between them. 2.6 hosting is merged, so the only thing left for a better voice is the ElevenLabs key; the client and its tests need no key and make no network call. Also in that Trail: the prompt now saves "done", "sent", "approved" and "ready" for after a button returns (channel note to Role 1 after the Trail #27 S4 round). 1.6's real median still waits on a live model run.
- **Done:** 1.1 prompt and fixed lines (Trail #8). 1.2 typed agent loop: `createAgentDriver` in `lib/agent/driver.ts` (an `AgentDriver`: every caller line through `checkCallerLine` first, streamed text split into sentences and each through `guardSentence`, every tool call a `control.press`, refusals and runaway turns handed over through `escalate`), the 12 buttons as strict tools (`tools.ts`), the sentence splitter, the Claude adapter (`anthropic.ts`, `claude-sonnet-5-5`, automatic tool choice, server-side fallback on refusal), and a scripted model for tests. Sam's typed call passes on the real lock and on the fakes. 1.3: `driver.opening` (fixed greeting, or outbound opener then `send_code`), `driver.joinCall` for the daily check's calls, the side-effect question after a refill (`read_label`, then `sideEffectQuestion`), and the answer as a `note_for_pharmacist` side-effect note in Review. Trail #8's 3 review findings fixed (wrong-person line, refill-sync wording, every fixed line tested on the real guard). 1.4: `/phone` (ring and Answer, code text, transcript with blocked lines struck through and labelled, typed box, status), a pure reducer in `app/phone/state.ts` fed only by `/api/events`. 1.5 part 1: `lib/voice` (numbers as words after the guard, end of turn after 600 ms of silence, Chrome speech in with the mic off while the agent speaks, hold-to-talk, Chrome voice out) and a voice bar on the phone. 1.6: `driver.turnTimings(callId)` (first model text and first guarded sentence per caller line) and the phone's median turn time against the 1.2 s target. 1.8: tap to interrupt, and `driver.checkIn` ("Are you still there? Take your time.") after 8 s of silence.
- **Blocked:** a live call needs `ANTHROPIC_API_KEY` in the server's `.env` (a human sets it). Tests need no key.
- **Needs from others:** Role 2: a TTS proxy route holding the ElevenLabs key — `POST /api/voice/clip {"text"}` → audio bytes, non-200 falls back to Chrome (REQUEST on the channel; `app/api/` is Role 2's folder, so 1.5 part 2 cannot finish without it).
  Role 4: still open — the label side-effect question from 1.1 (every seeded `labelText` holds directions only, so nothing can be quoted).
  Four earlier asks are now resolved on `main`, checked before striking them: `@anthropic-ai/sdk` is in `package.json` (1.12.0); `lookup_patient` returns `prescriptions: { rx_id, drug }[]`, so an inbound call has an `rx_id`; S4 computes the real run-out weekday (`runOutDay` in `lib/guard/speech.ts`), so SPEC's "runs out Friday" passes; and a side-effect note puts the refill in Review (`lib/control/engine.test.ts`).

## Role 2 · Platform and pharmacist

- **Doing:** waiting on merges: Trail #44 (2.9a Upcoming), #50 (2.9b Calls, after #44), #47 (voice route), #53 (S3/S4 originals on hijack cards for the stage), #54 (2.7 Tiger Data round trips: reset 2.3-4.4 s to 0.5 s, Sam's call store time 3.9 s to 1.5 s).
- **Real phone line (Trail #70, stand-in):** ElevenLabs Agents + Twilio with `/api/voice/llm` as its custom LLM (every word through the driver, buttons and guard), `/api/voice/outbound` ("Call Sam on a real phone" on Today, rule 7 first, code texted by Twilio), `scripts/elevenlabs-agent.ts`. Tested live through ElevenLabs by text; the first real call needs a Twilio number the account owns (hosting/README.md "Real phone calls").
- **Done:** 2.1 API and events. 2.2 demo reset and daily check. 2.3 Today. 2.4 Auth0 sign-in and Approve/Deny. 2.5 decided: no phone push. 2.6 deploy kit (Vultr + Caddy). 2.7 Postgres store on Tiger Data. 2.8 Quick check and the call record route.
- **Blocked:** 2.6 going live needs the Vultr server and the domain from a human. ElevenLabs needs a rotated key and ELEVENLABS_VOICE_ID in `.env`.
- **Needs from others:** Role 4: merge #44 before #50, then #47, #53, #54. Role 1: send the phone token from createClipFetcher to `/api/call/:id/speak`.

## Role 3 · Red team and evals

- **Doing:** 3.5 fixed suite, repeat scoring and persisted scoreboard (PR #30, claim #31, Trail #24), stacked on 3.3 runner review fixes (PR #26, Trail #17)
- **Done:** 3.1 first scenarios; 3.2 hijack driver (merged PR #7); 3.3 runner and scoring (merged PR #13); 3.4 hijack batch (merged PR #20, Trail #14)
- **Blocked:** live scoreboard needs the real driver and a model credential. Entire project visibility still blocks finding replies.
- **Needs from others:** Role 4 to review PR #26 before PR #30; Role 2 to wire `runFixedScenarioSuite` to the arena run route once the real driver lands.

## Role 4 · The lock

- **Doing:** integration (4.7) while 4.3 to 4.5 wait on a HUMAN ok; then 4.6 stage view
- **Done (covering, Trail #45):** 4.6 hijack screen on `/stage` (`role-4/hijack-screen`): four attack cards, a "Make it try…" box, a slow gate with rule chips, and Run batch. One picked attack runs through the real lock on its own store (`POST /stage/attack`, tagged `hijack_pick_<n>_<attack>`), and its record is saved under `results/hijack/pick-*/`.
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
