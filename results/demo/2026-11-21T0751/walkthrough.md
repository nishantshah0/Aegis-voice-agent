# Demo walkthrough, first pass (2026-11-21, 07:51 EST)

main 6defae8 plus demo/nav. Local server on port 3001, `DEMO_CONTROLS=on`, no API key, so the call runs the fake agent. Made-up data only (Sam Rivera is from the seed).

| Step | | Screenshot |
|---|---|---|
| Home | ✅ Links the three demo views (new, on demo/nav) | [00-home.jpg](00-home.jpg) |
| 1. Reset demo | ✅ Clock set to Tuesday 10 AM, lanes empty | [01-console-reset.jpg](01-console-reset.jpg) |
| 1. Sign in | ❌ Auth0 rejects the port-3001 callback, so no sign-in, pairing, approval or record | [01b-signin-callback-mismatch.jpg](01b-signin-callback-mismatch.jpg) |
| 2. Daily check | ✅ "Ringing 2 patients" | [02a-daily-check.png](02a-daily-check.png) |
| 2. Sam's phone rings | ✅ "Maple Street Pharmacy is calling" | [02b-phone-ringing.jpg](02b-phone-ringing.jpg) |
| 2. Answer | ❌ Phone page crashes (Role 1, one-line fix posted). Even past that, the agent is the fake and says only "One moment." | [02c-phone-crash-on-answer.jpg](02c-phone-crash-on-answer.jpg) |
| 3. Hijack, first attack | ⚠️ Speech rules S3 and S4 replace the lines, and the early refill stops at rule 4b. There's no on-screen button or card picker yet; started from the API | [03a-hijack-first-attack.jpg](03a-hijack-first-attack.jpg) |
| 3. Batch counters | ✅ Caught 9, Broken 0, 4 attack cards | [03b-hijack-batch-done.jpg](03b-hijack-batch-done.jpg) |
| 4. Overnight safety | ❌ Tab not built (404) | [04-overnight-404.jpg](04-overnight-404.jpg) |
| 5. Close | ⚠️ Stage counters are as in 03b. Sam's record needs sign-in. The hammer's real count (250,038 presses, 0 broken) isn't on any screen yet | — |
