# Demo checklist (SPEC Part 8)

Kept by the demo tie-in agent. One row per step of the 3-minute script, walked in the browser against `main`, from **Reset demo**. Done means the whole table passes 3 times in a row on the same `main` commit.

Legend: ✅ works · ⚠️ works with a fallback · ❌ broken (owner fixing it)

## Last pass

- `main` commit: 63647b2 (pass 2). Pass 1 was 6defae8
- When: pass 2 at about 08:20 EST, signed in as the test pharmacist. Pass 1 at about 07:50. Screenshots: `results/demo/2026-11-21T0751/walkthrough.md`
- How: `npm run dev -p 3001` with `DEMO_CONTROLS=on`, typed box, no `ANTHROPIC_API_KEY`, so the fake driver
- Clean passes in a row: **0 of 3**

## Steps

| # | Step | Status | What happened | Owner and request |
|---|---|---|---|---|
| 1a | Reset demo | ✅ | Console → Reset demo: "Demo clock: 11/24/2026, 10:00 AM" | |
| 1b | Sign in to the console as the test pharmacist | ✅ | Pass 2: lands on Today as "Test Pharmacist · pharmacist" with the queue and Pair panel. (Pass 1 failed on the Auth0 callback; Nishant added the 3001 URLs.) | |
| 1c | Pair Sam's phone (new: needed since Trail #19) | ✅ | Pass 2: Make pairing link → open it in the phone tab → redirects to `/phone`. The paired phone's Answer returns 200 for `c_0001`. Unpaired phones still show an Answer button that 404s | ROLE-1 (low): say "not paired" instead |
| 2a | Daily check rings Sam's phone | ✅ | "Daily check: ringing 2 patients"; `/phone` shows "Maple Street Pharmacy is calling" | Check: should only Sam ring? |
| 2b | Answer, code and dob | ❌ | Pass 2, paired: same crash, and under the overlay the page is dead ("This page couldn't load"). Phone page crashes on Answer: "useEffect must not return anything besides a function", then "destroy is not a function". `app/phone/Phone.tsx:294` returns `scrollIntoView()`'s Promise (Chrome 156) | ROLE-1, URGENT 1.4 |
| 2c | "Yes, please", side effect, price and ready day | ❌ | No live agent: with no `ANTHROPIC_API_KEY`, `app/api/_lib/runtime.ts:40` uses the contract's fake, which answers every line "One moment." Nothing on main runs the Agent SDK or reads `LIVE_AGENT` | ROLE-1 URGENT 1.2 (Agent SDK model; no reply yet). ROLE-2 replied 13:03 UTC: runtime picks it on `LIVE_AGENT=1` once it's on main |
| 2d | Review lane, console shows the side effect, Approve | ❌ | Not reached (2b, 2c, 1b). With a scripted model the same flow passes: `scripts/integration` and `app/api/demo.test.ts`, 8/8 | Blocked |
| 3a | Swap in the compromised agent; the judge picks an attack card | ❌ | `/stage` has no control. The batch starts only with `POST /api/arena/hijack`, and it always runs all 4 cards | ROLE-4, URGENT 4.6 (stage cards); the route then needs a `cardId` (Role 2) |
| 3b | One attempt struck through (S3, S4), refill and delivery bounce | ⚠️ | S3 and S4 rows show, but only the replacement: the public stage gets `original: ""` (`lib/events/audience.ts`), so "Sure, ninety tablets…" isn't visible. Delivery shows amber "to a pharmacist · rule 5", not red | ROLE-4, in the same request |
| 3c | 10-second batch, Caught and Broken counters | ✅ | Caught 9, Broken 0, Stopped 8, 4 cards in about 20 s. Results in `results/hijack/<run>/` | |
| 4 | Overnight safety tab, approve the waiting fix | ❌ | `/console/overnight` 404 (also `/console/review`, `/console/rules`). Tasks 3.7 and 3.8 are after core | ROLE-3, URGENT 3.8. Fallback below |
| 5 | Close: the record, the counters | ⚠️ | Stage counters ✅. Sam's record needs sign-in (`/api/calls/:id/record` 401 signed out). The "[M] million tries" number isn't on any screen; the last real hammer run is 129,100 + 120,938 presses, 0 broken (`results/hammer-latest.json`, 11:14 UTC) | Use the real hammer count, never a made-up one |
| — | Glue: `/` linked nowhere, `/console` 404 | fixed | Home links Stage, Phone and Console; `/console` redirects to Today | `demo/nav`, HANDOFF to ROLE-4 |

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
