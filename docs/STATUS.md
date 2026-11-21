# Status board

Every role (and its AI agent) updates its own section when it hands off. Claims are a CLAIM message on the agent channel plus an Entire Trail. Keep it short, newest first. For merged behavior, use [CURRENT.md](CURRENT.md); for live branch and review status, use [issue #1](https://github.com/nishantshah0/namereserve/issues/1). Role sections below need their owners to verify them after this audit.

## Who is working on what

The [agent channel](https://github.com/nishantshah0/namereserve/issues/1) records current claims and handoffs. The role sections below are each owner's short summary.

## Current checks

- Task 0's contract, control layer, guard, store and hammers are merged. The call API still uses a fake driver; Role 2 needs to wire the typed driver into the runtime.
- The public event stream still exposes call data, including verification digits. Role 2's audience fix is under review. Do not use the current stream with real patient data.
- The scenario suite and phone and voice work are on task branches; check the channel and pull requests for their latest review state before treating them as merged.
- Each role should update its own section below after reviewing this snapshot.

## Role 1 · Voice and agent

Role 1 runs from Nishant's machine from 1.2 on (MikeyDigit did 1.1).

- **Doing:** outbound call and side effects, phone page, voice and timing are in review on separate task branches; check the channel for the latest findings.
- **Done on `main`:** prompt and fixed lines; typed Claude driver and tests. The API has not switched to it yet.
- **Blocked:** a live call needs `ANTHROPIC_API_KEY` in the server's `.env` (a human sets it). Tests need no key.
- **Needs from others:** Role 2 to wire `createAgentDriver` into `app/api/_lib/runtime.ts` after the pending API reviews.

## Role 2 · Platform and pharmacist

- **Doing:** event audience and phone route fixes are in review. Next: wire the real driver into the API and hosting.
- **Done on `main`:** call and event API, demo reset and daily check, Auth0 console approvals, Today view. Phone push was dropped.
- **Blocked:** 
- **Needs from others:** Role 4's triage change and review of the stream audience branch.

## Role 3 · Red team and evals

- **Doing:** scenario suite and hijack batch fixes are in review; live scoring awaits the real driver and API route.
- **Done on `main`:** first ten scenario cards, hijack driver, replay runner and record-based policy scoring.
- **Blocked:** S3 still misses a written-out quantity (guard gap #10), outside Role 3's folder; numeric attack card is caught
- **Needs from others:** Role 4 to fix guard gap #10 through the lock approval process; Role 2 to wire the batch API after handoff

## Role 4 · The lock

- **Doing:** integration and review of lock changes; check the channel before merging.
- **Done on `main`:** contract, in-memory store and seed, control layer, speech guard, Stage view and hammers. The saved run at 11:14 UTC checked 50,518 exhaustive sequences and 10,000 seeded random sequences with 0 broken rules ([result](../results/hammer-latest.json)).
- **Blocked:** none reported; new lock changes still need code review and 0 broken rules in the hammer gate.
- **Needs from others:** code reviewer to review the outstanding lock changes.

---

## Contract change requests

Role 4 edits the contract on a task branch after review and a passing hammer gate, then announces the interface change with a DECISION. A "Contract change request" issue is optional.

## Open questions for humans

- Our teammate's OK to share his story, and in what words
- How many prize tracks one project can enter
- Judging format: tables or a stage, and how long per team
