# Decisions

One line each, newest first. If you're an AI agent, don't undo anything here without the team agreeing.

| When | Decision | Why |
|---|---|---|
| Sat early | Entire inside the product: the overnight fix loop runs on Entire Trails (`entire review`, the gate, a person's approval), and the Rules tab shows `entire why` for each rule. Agents review each other with Trail findings. Tokens are measured with `entire tokens profile` and `entire session tokens`. Never claim a percentage of AI-written lines. | The best Entire projects make it part of the product, and the prize asks for measured token efficiency |
| Sat early | Autonomous build: each role's agent runs a loop (`agents/role-<n>.md`) and talks on GitHub issue #1 through `scripts/channel.sh`. Role 4's agent merges after the gate. Contract and lock changes need a HUMAN "ok". Trail #2 on Entire is for human steering. | Entire blocks agents from posting Trail comments, GitHub issues work for every agent, and it shows on the repo |
| Sat early | Nobody is pre-assigned to a role. The contract with fakes is set up once as task 0, not owned by a role. Role 4 is renamed "The lock". | Nobody gets stuck with setup, and every role builds something visible |
| Sat early | All four roles write code. The pitch, video and Devpost are done by everyone together on Sunday morning. Tasks per role, in order, are in `docs/TASKS.md`. | Everyone wants to build, and the pitch takes a few hours at the end |
| Sat early | Entire is the agent workflow: Sessions captured on every commit, Trails for claims and handoffs, Graph for finding code, Brain for rules. GitHub issues and pull requests are the fallback. Discord is dropped. | It covers the coordination Discord would have, plus memory and review, and it's a prize track |
| Sat early | Entire transcripts go to the private repo `nishantshah0/namereserve-sessions`. Brain's background daemon and token-spending backfill are off. | The main repo may go public. No surprise token spend. |
| Sat early | Four build roles, no separate design and pitch role. Screens go to whoever produces their data. The pitch is everyone's. | The team doesn't need a dedicated design role, and every role then owns a visible piece |
| Sat early | Agents coordinate on GitHub: claim issues, contract-change issues, pull-request handoffs, and a release-gate workflow. Discord or Slack can mirror it later. | It's where the code is, every agent can use `gh`, no bot needed, and it shows on the repo |
| Sat early | Each agent works on a task branch and hands off; Role 4's agent is the coordinating agent and integrates into `main` | From the team's AGENTS.md: disjoint scopes, no broken `main` |
| Sat early | Each folder has one owner (`docs/DESIGN.md` section 2) | Stops two people's AI tools overwriting each other |
| Sat early | In-memory store first, Postgres later behind the same interface | Nobody waits on the database |
| Sat early | One `AgentDriver` interface for real, hijacked and scenario calls | "Everything is a call." The hijack proof must use the real path. |
| Sat early | Core demo first: call, control layer, guards, side effects, approval, hijack, console Today, stage, hammers | Four people, about 30 hours |
| Sat early | Stack: Next.js and TypeScript with Tailwind, Vitest, Postgres on Tiger Data, Chrome speech in, ElevenLabs out, Auth0, Vultr | One language, a familiar stack, prize tracks covered |
| Sat early | Rule 4b allows a controlled refill up to 3 days before the prescriber's interval | Otherwise Sam's reminder call ends in "refused" |
| Sat early | Triage lanes (Automatic, Quick check, Review) are chosen in code, never by the AI | The pharmacist only sees tricky calls, for reasons based on facts |
| Sat early | The AI's self-reported confidence is shown but never used for decisions | Models are often overconfident |
| Sat early | Nothing from earlier projects is reused | Everything is built this weekend |
