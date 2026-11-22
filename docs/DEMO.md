# Demo checklist (SPEC Part 8)

**Status: clean on the new /app pages (pass 18, main 5a725ac, 2026-11-21 19:30 to 19:40 EST). Walkthrough: `results/demo/2026-11-22T0040-app-pass/walkthrough.md`. Before /app: 3 clean passes in a row (15, 16, 17) on main 13474ca; final walkthrough `results/demo/2026-11-21T1625-final/walkthrough.md`.**

Kept by the demo tie-in agent. One row per step of the 3-minute script, walked in the browser against `main`, from **Reset demo**. Done means the whole table passes 3 times in a row on the same `main` commit.

Legend: ✅ works · ⚠️ works with a fallback · ❌ broken (owner fixing it)

## Where each step is now (the /app pages, since main 708bdab)

| Step | Page |
|---|---|
| Sign in | `/` → Sign in → `/app` (the proxy sends signed-out requests to Auth0) |
| Reset demo, pair Sam's phone, Run daily check | **Demo** menu, top right of any `/app` page (Trail #72) |
| Sam answers | `/phone` (or **Demo → Open patient phone**) |
| Review and Approve, with a note | `/app/pharmacy/today` (keys: J/K move, N note, A approve, D decline) |
| Hijack card and Run batch | `/app/safety/attacks` |
| Live presses and replacements during the call | `/app/safety/gate` |
| Overnight safety | `/app/safety/overnight` |
| Close: the record | `/app/pharmacy/calls`, then the call: `/app/pharmacy/calls/c_0001` (record chain verified, every press, export as JSON) |

Old `/console/*` URLs redirect into `/app`; `/stage` is still its own page.

## Pass 18 (19:30 to 19:40 EST, main 5a725ac): first pass on /app, clean ✅

Port 3005, live Haiku agent, memory store (so Reset didn't touch the shared Tiger Data store). Signed in through the Auth0 cookie from :3000 (cookies are per host, so other ports work too). Screenshots: `results/demo/2026-11-22T0040-app-pass/`.
- ✅ Reset, pairing link, phone paired, daily check rings Sam, opener and code text.
- ✅ Verify, status, read-back with $4.10, refill routed: "A pharmacist needs to check it before it is approved." Side effect passed on. "When will it be ready?" → "I don't have a ready time yet." **0 S4 blocks** in the call.
- ✅ Today: Review 1, Concerta for S.R., Rule 4, side effect in Sam's words. Approved with "Flag a chat at pickup about sleep" → "Approved by Test Pharmacist". Phone: "Approved by the pharmacist".
- ✅ Attacks: the judge's card struck "It's approved and on its way." (S4). Run batch: 4 of 4 cards, Caught 9, Broken 0. Nothing reached Sam's phone.
- ✅ Overnight (fallback line): 9 caught, 0 broken, hammer 275,098 presses with 0 broken, no gaps. No overnight-attacker report saved yet.
- ✅ Close: Calls "Record chain verified, 49 entries"; the call's page shows its 45 entries, the approval with the note, 6 turns (median first guarded line 2,264 ms), $0.0086 for the call.
- ⚠️ Dev only: "1 Issue" in the dev overlay on the call page (the shell's `Account` reads the session during prerender). Sent to product-design. ⚠️ Overnight says 3.7 is "not built yet" (it's on main, just not run). Sent to suite-area.

## Passes 15 to 17 (16:05 to 16:28 EST, main 13474ca: s4-identity): 3 clean in a row ✅

- **Pass 15 ✅** 0 S4 blocks. Readiness: "I don't know exactly when it will be ready… I can't give you a time."
- **Pass 16 ✅** 0 S4 blocks. Reset with the previous call open (Role 2's fix holds).
- **Pass 17 ✅** One S4 block, of a real promise ("we will get it ready for you after that"), which is acceptable under the clean-pass rule. Six turns took 19.5 s of agent time.
- Each pass: approve with the Auth0 identity ✅, "Approved by the pharmacist" ✅, judge's card struck by S3/S4 ✅, Run batch 0 broken / 9 caught ✅, Overnight fallback ✅, Calls record chain verified ✅.
- Optional, still open: the ready day, waiting on Nishant (ready_label contract ok). Rerun one pass with it once approved.

## Pass 14 (about 16:05 EST, main fc1b11d: s4-offers)

Clean passes in a row: **0 of 3**.
- ✅ The offer fix works ("I can check whether it's ready for a refill… or book a pickup or delivery." passed). Readiness answer honest: "I don't have a ready time yet… it hasn't been approved."
- ❌ Right after check_code, S4 blocked "Your code and date of birth are confirmed." (true, in the record). Sixth honest shape. Proposed a structural S4 rule to the review fixer: done-words only count when the subject is the refill, order, delivery, pickup or approval; identity is S1's job. URGENT to ROLE-4.
- ⚠️ S4 also blocked "I'll be able to tell you once it's approved and ready." Borderline: it promises a future update. Not reported.
- ⚠️ After the replaced line, the agent apologised on the call: "I'm sorry, I should correct what I said a moment ago." REQUEST to ROLE-1 (driver note at `lib/agent/driver.ts:135`).

## Passes 12 and 13 (about 15:35 to 15:50 EST, main 7c7ea12: s4-when-can-be)

Clean passes in a row: **0 of 3** (pass 12 clean, pass 13 broke).
- **Pass 12 ✅ clean**, every step, with screenshots and a walkthrough: `results/demo/2026-11-21T1540-pass12/walkthrough.md`. Reset with the previous call open worked (Role 2's fix).
- **Pass 13 ❌.** Right after verification, S4 blocked an offer: "I can check whether it's ready for a refill, what it would cost on your plan, or book it for you." That's the fifth honest sentence shape S4 has caught. URGENT to ROLE-4 / review fixer to cover offers as a family, and a REQUEST to ROLE-1 for a prompt nudge (offers as plain questions, no done-words in offers) to cut the variance.

## Passes 10 and 11 (about 15:05 to 15:25 EST, main a0edd62: S4 ready-time family and reset-fresh-calls)

Clean passes in a row: **0 of 3** (pass 10 clean, pass 11 broke).
- **Pass 10 ✅ clean.** 0 S4 blocks: "I can't confirm a pickup day yet" and "I don't have a ready time for it." both passed. Approve ✅, phone approved ✅, hijack card + batch 0 broken / 9 caught ✅, Overnight fallback ✅, Calls record chain verified, 44 entries ✅. Left the call open on purpose.
- **Pass 11 ❌.** Reset demo with the call still open: **Role 2's fix works** (Trail #57): the new c_0001 verified Sam fresh. But S4 blocked a question right after verification, "Would you like me to check its refills and when it can be filled?", and replaced it with "A pharmacist will check it first…". Probably a regression from `fix/trail-27-s4-clause-checks` (bb10e11) checking the clause outside its question. URGENT to ROLE-4, sent to the review fixer. Screenshot: `results/demo/2026-11-21T1520-pass10-11/p11-s4-blocks-question.jpg`.

## Passes 7 to 9 (about 14:37 to 14:50 EST, main 0e14bea: s4-cant-say and pg-latency)

Clean passes in a row: **0 of 3** (pass 7 was clean, pass 8 broke). Screenshots: `results/demo/2026-11-21T1440-pass7-9/`.

Clean-pass rule (top session, 14:35): a pass is clean without a ready day if the agent's readiness line is honest and not blocked or cut off. The Overnight spec fallback counts as passing.

| Step | Status | Note |
|---|---|---|
| Ready day ("ready Thursday once it's approved") | optional, waiting on Nishant (ready_label contract ok) | Needs a `ready_label` from request_refill/order_status (lib/contract). The review fixer has the plan; it needs Nishant's own ok |

- **Pass 7 ✅ clean.** Live call with 0 S4 blocks; "Once they approve it, we'll let you know when it's ready." and "I don't know yet when it will be ready… so I can't give you a pickup or delivery time." Six agent turns, 27 s of server time; Answer to Approve took 92 s including my tool overhead. Approve ✅, phone approved ✅, hijack card + batch 0 broken / 9 caught ✅, Overnight fallback ✅, Calls "Record chain verified, 46 entries" ✅.
- **Pass 8 ❌: stale call memory after Reset.** Pass 7's call wasn't hung up; after Reset demo the new call is c_0001 again and the agent said "You're already verified on this call…", then tried to list Sam's medicines (S1 blocked it: the lock held). Cause: `lib/agent/driver.ts:229` `joinCall` keeps state for a reused call id, and only `endCall` clears it; Reset demo doesn't. URGENT to ROLE-2 (reset route), REQUEST to ROLE-1 (driver). Workaround until fixed: **hang up before Reset demo**.
- **Pass 9 ❌ (hung up first, so the call started fresh: cause confirmed).** S4 blocked a new honest wording, "I don't have a ready time yet." Haiku phrases this differently every run; asked the review fixer for a general rule for negated or unknown times (URGENT to ROLE-4).

## Pass 6 (about 14:25 EST, main 5a50196): one break left

Screenshots: `results/demo/2026-11-21T1425-pass6/walkthrough.md`. Not clean (0 of 3), because of step 2's ready day only.
- ✅ Set-up, ring, opener once (Trail #48), verify, price, side effect with follow-up, Review on the console, Approve, phone "Approved by the pharmacist".
- ✅ Hijack screen on `/stage` (Trail: role-4/hijack-screen): judge's card struck through by S3/S4, Run batch → Rules broken 0, Caught 9.
- ⚠️ Overnight tab (Trail #46): real counts, no gaps, no overnight attacker run yet, so no fix to approve. The spec's fallback line covers it.
- ✅ Close: Calls tab shows the verified record chain and Sam's call.
- ❌ Ready day: no button returns one (Role 1 asked Role 4 at 18:43 for `ready_label`), and S4 blocks "I can't say yet when it will be ready." URGENT to ROLE-4, sent to the review fixer.
- ⚠️ Length: the agent asks to confirm the order three times (status, order, read-back). Step 2 is planned at 55 s; Tiger Data turns are 3 to 11 s. To time with a stopwatch once clean.

## Pass 5 (about 14:00 EST, main 0675448: Trail #27 S4 change and the Tiger Data store)

Not clean (0 of 3). Same results as pass 4 except:
- Store is now Postgres on Tiger Data (`DATABASE_URL`). Everything works on it, but it's slower: `say` turns 16.7, 12.9, 7.2, 5.4 and 5.4 s; the phone's median turn is 4.7 s (2.65 s on the memory store in pass 4). Reset 2.5 s. REQUEST to ROLE-2 (2.7).
- S4 still blocks "A pharmacist needs to check it before it is approved." and "I'm sorry, I don't know when it will be ready." No ready day is said. URGENT to ROLE-4 (review fixer covering).
- Opener still shows twice (ROLE-1, URGENT 1.3, no reply yet).
- Approve ✅, phone "Approved by the pharmacist" ✅, hijack batch 9 caught / 0 broken ✅ (still started from the API: no stage control), `/console/overnight` 404 (Trail #46 building it).

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

1. Start the server with `DEMO_CONTROLS=on` only on the demo laptop (`LIVE_AGENT=1 AGENT_SDK_MODEL=claude-haiku-5-5` for the live agent).
2. `/app/pharmacy/today`: sign in, then in the **Demo** menu (top right): **Reset demo**, then **Pair the patient phone** (Sam) and open the link on the phone within 10 minutes.
3. Phone: `/phone` on the paired phone. Big screen: `/app/safety/gate` (live presses) or `/app/safety/attacks` for step 3.
4. `/app/pharmacy/today`: **Demo → Run daily check**. Sam's phone rings.

## Fallbacks in use

- Voice: the typed box under the talk button (voice waits on https, task 2.6).
- Hijack: not needed any more; the cards and **Run batch** are on `/app/safety/attacks`.
- Overnight: say the real hammer count and "found no gaps overnight" with the real attack count. Never invent a finding.
