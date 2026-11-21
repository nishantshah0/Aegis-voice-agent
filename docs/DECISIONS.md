# Decisions

One line each, newest first. If you're an AI agent, don't undo anything here without the team agreeing.

| When | Decision | Why |
|---|---|---|
| Sat early | Each agent works on a task branch and hands off; Claude on Nishant's laptop is the coordinating agent and integrates into `main` | From the team's AGENTS.md: disjoint scopes, no broken `main` |
| Sat early | The repo files are the channel for AI agents: `AGENTS.md`, `lib/contract/`, `docs/STATUS.md`, this file, GitHub issues. No custom agent-to-agent messaging. | Every AI tool can read and write files. Anything more is build time taken from the product. |
| Sat early | Each folder has one owner (`docs/DESIGN.md` section 2) | Stops two people's AI tools overwriting each other |
| Sat early | In-memory store first, Postgres later behind the same interface | Nobody waits on the database |
| Sat early | One `AgentDriver` interface for real, hijacked and scenario calls | "Everything is a call." The hijack proof must use the real path. |
| Sat early | Core demo first: call, control layer, guards, side effects, approval, hijack, console Today, stage, hammers | Four people, about 30 hours |
| Sat early | Stack: Next.js and TypeScript with Tailwind, Vitest, Postgres on Tiger Data, Chrome speech in, ElevenLabs out, Auth0, Vultr | One language, a familiar stack, prize tracks covered |
| Sat early | Rule 4b allows a controlled refill up to 3 days before the prescriber's interval | Otherwise Sam's reminder call ends in "refused" |
| Sat early | Triage lanes (Automatic, Quick check, Review) are chosen in code, never by the AI | The pharmacist only sees tricky calls, for reasons based on facts |
| Sat early | The AI's self-reported confidence is shown but never used for decisions | Models are often overconfident |
| Sat early | Nothing from earlier projects is reused | Everything is built this weekend |
