# Demo walkthrough: first run-through with the live agent (2026-11-21, 12:30 EST)

main ef144a5 plus `role-2/live-agent` (Trail #41) and `role-1/agent-sdk-live-fixes` (Trail #43), neither merged yet. Local server on port 3001 with `LIVE_AGENT=1` on claude-haiku-5-5, signed in as the test pharmacist. Typed box, no voice. Made-up data only (Sam Rivera is from the seed). Agent usage for the whole call: 5 turns, 11 model calls, 1,739 output tokens (`results/agent-usage.jsonl`).

| Step | | Screenshot |
|---|---|---|
| 1. Set-up | ✅ Sign in, Reset demo, pair Sam's phone, Run daily check | — |
| 2. Sam's phone rings | ✅ "Maple Street Pharmacy is calling" | [02a-phone-ringing.jpg](02a-phone-ringing.jpg) |
| 2. Opener and code | ✅ "This is Maple Street Pharmacy calling for Sam Rivera…", and the code arrives as a text. ⚠️ The opener shows twice | [02b-opener-and-code.jpg](02b-opener-and-code.jpg) |
| 2. Code and date of birth | ✅ "Thank you, Sam. You're verified." | — |
| 2. "Yes, please" | ✅ Reads the label, "$4.10 on your plan", asks once more, then sends the request: "A pharmacist needs to check it before it is approved" | — |
| 2. Side effect | ✅ "Actually, I've been sleeping badly." → "Thanks, I've passed that to the pharmacist with your refill." | — |
| 2. Ready day | ❌ Never given. Asked "When will it be ready?", the speech guard (S4) blocks "I don't know exactly when it will be ready" and an offer to ask the pharmacist. 3 S4 blocks in the call | [02c-call-s4-blocks.jpg](02c-call-s4-blocks.jpg) |
| 2. Console, Review lane | ✅ Review 1: Concerta 36 mg for S.R., Rule 4, the side effect in Sam's words, every spoken line marked checked or blocked | [02d-console-review-sam.jpg](02d-console-review-sam.jpg) |
| 2. Approve, chat at pickup | ✅ Note "Flag a chat at pickup about sleep", Approve | [02e-console-approve.jpg](02e-console-approve.jpg), [02f-console-approved.jpg](02f-console-approved.jpg) |
| 2. Sam's phone | ✅ "Approved by the pharmacist" (no ready day) | [02g-phone-approved.jpg](02g-phone-approved.jpg) |
| 2. Stage during the call | ✅ Each press and S4 replacement live | [02h-stage-during-call.jpg](02h-stage-during-call.jpg) |
| 3. Hijack | ⚠️ Still no button or card picker on `/stage`; started from the API. Attacks now carry their own ids (`hijack_1_…`) | [03a-hijack-first-attacks.jpg](03a-hijack-first-attacks.jpg) |
| 3. Batch counters | ✅ Rules broken 0, Attacks caught 9, Stopped 8 | [03b-hijack-batch-done.jpg](03b-hijack-batch-done.jpg) |
| 4. Overnight safety | ❌ `/console/overnight` 404 | [04-overnight-404.jpg](04-overnight-404.jpg) |
| 5. Close: the record | ⚠️ `/api/calls/c_0001/record`: 45 hash-chained entries; the approval carries the Auth0 identity (Test Pharmacist, pharmacist) and the note. JSON only, no screen shows it | — |
