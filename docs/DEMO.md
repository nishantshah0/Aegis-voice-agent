# Demo checklist (SPEC Part 8)

Kept by the demo tie-in agent. One row per step of the 3-minute script, walked in the browser against `main`, from **Reset demo**. Done means the whole table passes 3 times in a row on the same `main` commit.

Legend: ✅ works · ⚠️ works with a fallback · ❌ broken (owner fixing it)

## Last pass (pass 4: first run-through with the live agent)

- Code: main ef144a5 plus `role-2/live-agent` (Trail #41) and `role-1/agent-sdk-live-fixes` (Trail #43). Both have merged since, in main f2e6eb0
- When: 2026-11-21 about 12:30 EST. Screenshots: `results/demo/2026-11-21T1230-live/walkthrough.md`
- How: `LIVE_AGENT=1 AGENT_SDK_MODEL=claude-haiku-5-5 DEMO_CONTROLS=on next dev -p 3001`, signed in as the test pharmacist, typed box. Agent usage for the call: 5 turns, 11 model calls, 1,739 output tokens
- Clean passes in a row: **0 of 3**. The script runs through, but steps 3 and 4 have no screen yet

## Steps

| # | Step | Status | What happened (pass 4) | Owner and request |
|---|---|---|---|---|
| 1a | Reset demo | ✅ | Clock 11/24/2026 10:00 AM | |
| 1b | Sign in to the console | ✅ | "Test Pharmacist · pharmacist" | |
| 1c | Pair Sam's phone (needed since Trail #19) | ✅ | Pairing link → phone tab → `/phone`. Unpaired phones still show an Answer button that 404s | ROLE-1 (low) |
| 2a | Daily check rings Sam's phone | ✅ | "Maple Street Pharmacy is calling" | |
| 2b | Answer, opener, code, date of birth | ✅ ⚠️ | Opener and code text arrive; "Thank you, Sam. You're verified." The opener shows twice on the phone | ROLE-1, URGENT 1.3 (duplicate opener) |
| 2c | "Yes, please", price | ✅ | Reads the label, "$4.10 on your plan", confirms, routes: "A pharmacist needs to check it before it is approved" | |
| 2d | Side effect | ✅ | "Actually, I've been sleeping badly." → "Thanks, I've passed that to the pharmacist with your refill." | |
| 2e | Ready day | ❌ | Never said. Asked when, S4 blocks "I don't know exactly when it will be ready" and an offer to ask the pharmacist: 3 "Stopped by S4" labels in one ordinary call | ROLE-4 URGENT 4.4 (S4 over-blocks), ROLE-1 URGENT 1.3 (say the governed ready day) |
| 2f | Review lane on the console, Approve with a chat at pickup | ✅ | Review 1: Concerta for S.R., Rule 4, side effect in Sam's words, every line checked or blocked. Approved with the note; record has the Auth0 approver | |
| 2g | Sam's phone shows the approval | ✅ ⚠️ | "Approved by the pharmacist", with no ready day | Same as 2e |
| 2h | Stage follows the call | ✅ ⚠️ | Presses and S4 replacements live. Lane counts differ from the console (stage Review 2 and Quick check 1, console Review 1) | ROLE-4 (low) |
| 3a | Swap in the compromised agent; the judge picks a card | ❌ | Still no control on `/stage`; batch started from `POST /api/arena/hijack` | ROLE-4, URGENT 4.6 |
| 3b | One attempt struck through, refill and delivery bounce | ✅ ⚠️ | S1, S3, S4 rows with the struck original, rules 1, 4b, 5. Originals show only to a signed-in stage; a public projector gets the replacement only | ROLE-4 decides |
| 3c | Batch counters | ✅ | Rules broken 0, Attacks caught 9, Stopped 8. Ids are now `hijack_1_…` (Trail #14) | |
| 4 | Overnight safety tab | ❌ | `/console/overnight` 404 | ROLE-3, URGENT 3.8. Fallback below |
| 5 | Close: the record, the counters | ⚠️ | `/api/calls/c_0001/record`: 45 hash-chained entries, approval with the Auth0 identity and the note. JSON only, no screen. Real hammer count: 250,038 presses, 0 broken | A record view would help (Role 2 or 3) |

Note: the phone and stage tabs share the signed-in console's cookies in this test, so they see blocked originals. A real phone or projector that isn't signed in sees replacements only.

## Pass 3 (about 08:15 EST): main 63647b2 plus `role-1/phone-answer-crash` (Trail #37), pre-merge check

- Reset, sign-in, pairing, daily check, ring ✅.
- Answer ✅ with Role 1's fix: the call screen opens with the typed box, no crash. Trail #37 is good to merge.
- Transcript ✅: "Hi, this is Sam" shows, and the reply is the fake's "One moment."
- Answer returns `events: []`: the fake driver has no opening and sends no code, so the "Refill Guard Pharmacy, calling for Sam Rivera…" opener and the code text never appear. Same root cause as 2c, so the live agent is now the only blocker for step 2.

## Main session's signed-in pass (about 08:10 EST, same server)

- Set-up ✅: signed in as the test pharmacist, Reset demo, pairing link for Sam, phone paired.
- Step 2 ❌: the daily check rings Sam ✅, but Answer crashes `/phone` (`Phone.tsx:294`, same as 2b). URGENT to Role 1, with the review fixer as backup after 10 minutes.
- Approve: not reached. From now on, when an item reaches Review, the demo tie-in messages the main session to approve from its signed-in pane (or approves itself, being signed in too).
- Step 3 ❌: no hijack UI on `/stage`. URGENT to Role 4 for an attack-card panel.
- Step 4 ❌: `/console/overnight` 404. REQUEST to Role 3 for a minimal page from `results/arena/`.
- Landing ⚠️: main still has the placeholder. `demo/nav` (Trail #35) replaces it with links, and the product-design agent is building a full landing page. Both touch `app/page.tsx`: whichever merges second takes the other's links.

## Known breaks the code reviewer already sent (tracked here, not re-reported)

| # | Break | Owner | Status on main |
|---|---|---|---|
| R1 | Step 2: the phone listened without `{ callId, token }`, so no transcript and no voice | Role 1 | Fixed on main (ce28d0c, Trail #19). Re-check when the call runs |
| R2 | Step 3: the hijack batch emits its attack events as `c_0001` on the live bus, so Sam's phone would show them | Role 3 | Still on main: every stage row in pass 1 shows `c_0001` |
| R3 | Lock: "Approved! You don't need to call back." passes the speech guard | Role 4, Trail #27 | Merged on main 63647b2 (fix/trail-27-s4-conditional). Re-check when the call runs |

Landed since pass 1: Trail #32 (lock fails closed, codes off by default) on main 3d4bbc8.

## Set-up order (as main works today)

1. Start the server with `DEMO_CONTROLS=on` only on the demo laptop.
2. Console: sign in, **Reset demo**, then **Pair a patient's phone** (Sam) and open the link on the phone within 10 minutes.
3. Phone: `/phone` on the paired phone. Stage: `/stage` on the big screen.
4. Console: **Run daily check**. Sam's phone rings.

## Fallbacks in use

- Voice: the typed box under the talk button (voice waits on https, task 2.6).
- Hijack: start the batch with `POST /api/arena/hijack` (needs `DEMO_CONTROLS=on` or a signed-in pharmacist) until the stage has its cards.
- Overnight: say the real hammer count and "found no gaps overnight" with the real attack count. Never invent a finding.
