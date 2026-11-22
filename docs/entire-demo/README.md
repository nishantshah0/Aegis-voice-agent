# Aegis pharmacy call review

[Open the public audio demo](https://aegis-pharmacy-review.nishantshah2573.chatgpt.site)

## A 90-second walkthrough

1. Open **Checking a refill** and press **Play case**. Demo pass 13 blocked a genuine offer to check a refill. The exact assertion failed at `aeb4522` and passed at `f9ec386`. Pass 14 also recorded the corrected behavior. Show the two saved verdicts, then the merged change. [Trail 27](https://entire.com/gh/nishantshah0/-/trails/27/changes/namereserve/25) · [Demo log](https://github.com/nishantshah0/namereserve/blob/68ef0f4/docs/DEMO.md#L43)
2. Select **Reporting a side effect**. Play the four synthetic lines. The conversation test records the symptom, onset, and severity. A separate queue test sends the matching refill for pharmacist review. Two team roles merged the changes independently. [Voice follow-up](https://entire.com/gh/nishantshah0/-/trails/52/changes/namereserve/50) · [Queue routing](https://entire.com/gh/nishantshah0/-/trails/25/changes/namereserve/24)
3. Open **Graph benchmark**. Across three lookup questions, repeated twice, Claude Haiku 5.5 answered six of six correctly in each arm. Graph-first used 21,299 provider-reported model tokens. Source-search-first used 163,359. This measures these selected lookup tasks only. [Run traces](dist/benchmark.json)
4. If asked about limitations, select **Two different refills**. The order and scoring assertions pass. A multi-turn spoken-status assertion remains marked as an expected failure. The audio here reenacts the caller prompts only. [Trail 39](https://entire.com/gh/nishantshah0/-/trails/39/changes/namereserve/37)

## Inspect the evidence

The public page replays exported dialogue and results. Its audio was synthesized with ElevenLabs. It requires no account, service keys or microphone. The team repository and some Entire views require access.

The reproducibility snapshot targets commit `68ef0f482393b79f0beb14ecd53606fdfdf43c6a`. The before/after run uses two isolated checkouts, the same assertion already present on both commits, and the same Vitest setup.

```sh
npm exec -- vitest run lib/guard/s4-clauses.test.ts -t 'allows: I can check whether'
entire trail show 27 --project gh/nishantshah0
entire brain get fact:202079edea1be33a6409cc1a
```

To repeat the benchmark, copy `compare.mjs` outside the repository, open a clean checkout at the snapshot revision, and run `node /path/to/compare.mjs /path/to/new-results.json` with Git, Entire Graph, Node 22+ and an Anthropic API key in the environment. Repetition uses paid model calls. Three preselected answer keys, separate fresh conversations, two repetitions, an eight-turn cap, the same source-reading tools, and bounded tool responses make the comparison inspectable. A preliminary text-JSON harness sometimes produced unparseable commands and was excluded. The published runs use native tool calls in both arms. Results can vary on rerun.

[Historical assertion results](dist/readiness.json) · [Review and Brain evidence](proof.json) · [Sponsor criteria](https://hack-western-13.devpost.com/)
