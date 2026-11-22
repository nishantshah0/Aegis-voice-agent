# Live agent runs (Trail #75)

Real calls on the real lock (memory store, real control layer, speech guard and safety check) with the live model: Claude Haiku 5.5 through the Claude Agent SDK on this machine's Claude login. The callers are scripted lines from `lib/agent/live-range.test.ts`, not a second model. Each `<call>.json` has every turn: what the caller said, what the caller heard, every button press with its result, every line the guard replaced, and the turn timings. `transcript.md` has the same as plain text.

```
LIVE_AGENT=1 LIVE_RUN=<name> npx vitest run lib/agent/live-range.test.ts
```

| Run | Code | Calls | Model calls | Median turn | Median first sentence | Lines replaced |
|---|---|---|---|---|---|---|
| range-1 | before the warm-up and the double-confirm fix | 1 (stopped) | 7 | 8.98 s | 6.90 s | 1 |
| range-2 | warm-up, one read-back | 5 (stopped to stay under the hourly cap) | 41 | 3.97 s | 1.72 s | 4 |
| range-3 | plus label prefetch, code line word for word, booked not done | 3 | 17 | 3.93 s | 1.88 s | 2 |

Timings were taken on a heavily loaded machine (load average about 220, other sessions running test suites), so they are an upper bound. The first turn of range-1 took 37 s, almost all of it the Agent SDK starting up; the warm-up in `opening()` moved that cost off the first caller line.

What each run found, and what changed because of it, is in the Trail #75 commits: range-1 led to the warm-up and "a yes to the offer is the yes"; range-2 to the label prefetch (Haiku guessed a strength), the code line said word for word, booking a window the caller already named, and "booked" instead of "done"; range-3 to "sorted" and "all set" counting as done-words, and not repeating the name on a bare "hello".
