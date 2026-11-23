<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg">
    <img src="public/brand/logo.svg" alt="Aegis" height="56">
  </picture>
</p>

<h3 align="center">The AI can be fooled. The pharmacy can't.</h3>

<p align="center">
  Aegis is a pharmacy phone agent prototype. It calls patients about refills, handles routine steps, and sends exceptions to a pharmacist. Code checks every action and spoken line.
</p>

<p align="center">🏆 <strong>Winner, Best Use of Auth0</strong> · Hack Western 13</p>

<p align="center"><strong>Synthetic demo data only · Not for clinical use</strong></p>

<p align="center"><a href="public/brand/hero-flowers-dithered-4x4.mp4"><img src="docs/images/flowers-loop.gif" alt="Looping preview of the Aegis landing-page flowers" width="900"></a></p>
<p align="center"><sub><a href="public/brand/hero-flowers-dithered-4x4.mp4">Watch the full flower video</a></sub></p>

## A look

| Landing page | Pharmacist's Today queue |
|---|---|
| ![Aegis landing page with a live call transcript](docs/images/landing.png) | ![The pharmacist's Today queue with one call's checked lines](docs/images/console.png) |

| Stage view | Patient phone |
|---|---|
| ![Stage view counting rules broken, attacks caught and presses stopped](docs/images/stage.png) | ![The patient's phone page waiting for the pharmacy to call](docs/images/phone.png) |

Screenshots are from the hackathon build, on made-up patients.

## How it works

1. Aegis calls patients before their medication runs out and gathers the information needed for a refill.
2. The agent can act only through the 12 defined buttons. Every press goes through the control layer and its rules.
3. Every spoken sentence goes through `guardSentence`, which can replace unsafe or unsupported wording.
4. Calls, scripted scenarios, and attacks use the same agent, rules, and decision record. Exceptions go to a pharmacist for review.

```mermaid
flowchart LR
  Patient[Patient phone] <-->|voice or text| Agent[Call agent]
  Agent -->|12 buttons| Control[Control layer and rules]
  Agent -->|spoken sentences| Guard[Speech guard]
  Control --> Record[(Call record)]
  Guard --> Record
  Control -->|exceptions| Pharmacy[Pharmacy workspace]
  Record --> Safety[Safety suite and evidence]
  Attacks[Scenarios and attacks] --> Agent
```

## Stack

| Part | Built with |
|---|---|
| App | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Call agent | Claude (Anthropic SDK and Claude Agent SDK) |
| Attacker models | Claude and Gemini |
| Sign-in and roles | Auth0 |
| Phone and voice | Twilio, ElevenLabs |
| Store | Postgres, or an in-memory store when `DATABASE_URL` is not set |
| Tests | Vitest, PGlite |

## Workspaces

| Area | Pages |
|---|---|
| Public site | Home `/`, patient phone `/phone`, stage view `/stage` |
| Pharmacy | Home `/app`, Today `/app/pharmacy/today`, Upcoming refills `/app/pharmacy/upcoming`, Simulated forecast `/app/pharmacy/outreach`, Calls `/app/pharmacy/calls`, Call quality `/app/pharmacy/review`, Phone (DEMO ONLY) `/app/pharmacy/phone` |
| Safety suite | Overview `/app/safety`, Release gate `/app/safety/gate-report`, Business tests `/app/safety/business-tests`, Scenarios `/app/safety/scenarios`, Attack library `/app/safety/attacks`, Evals `/app/safety/evals`, Overnight `/app/safety/overnight`, Live calls `/app/safety/live-calls`, Live gate `/app/safety/gate`, Rules `/app/safety/rules`, Rule writer `/app/safety/rule-writer` |

The Pharmacy and Safety workspaces require an authenticated pharmacist or reviewer, or a configured presenter session. Phone and Safety demonstrations use synthetic records. The stage view follows call events and is useful for presentations.

## Run locally

Use Node.js 22.12 or newer.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public site and seeded interface can run without live-service credentials; without a live agent configuration, calls use the built-in fake. The signed-in workspaces need Auth0 configuration; live AI and voice features need the corresponding provider credentials. See [.env.example](.env.example) for available settings. Without `DATABASE_URL`, the app uses its in-memory store.

Never put real patient data or credentials in the repository. Keep local secrets in `.env`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run hammer
npm run build
node scripts/gate.ts
```

The hammer exercises hostile button sequences against the control layer. `node scripts/gate.ts` runs the full local release gate and records its results with the commit and run time.

## Known limits

- **The buttons are the hard boundary. Speech is best effort.** The control layer decides every action in code. The speech guard's dose and promise checks (S3 and S4) match patterns, so a phrasing it hasn't seen can still be spoken. The first red-team run broke the guard on 586 of 624 attacks (`results/redteam/2026-11-22-speech/report.json`). The patterns were then fixed against that same set, so later scores on it are not a held-out measure.
- **Safe is not the same as helpful.** On the 28-scenario suite the live agent broke 0 rules, but reached the expected outcome on 16 of 28 scenarios with Haiku 5.5 and 15 of 28 with Sonnet 5.5 (`results/arena/scenarios-models/comparison.json`).
- **Demo only.** Every patient is made up, and nothing here has been reviewed for clinical or privacy compliance.

## Team

Four people built Aegis in one weekend. Each person ran a coding agent on one role, and the agents coordinated through a shared rulebook, a message channel and the release gate ([how the agents worked](docs/AUTONOMY.md), [the rules](docs/RULES.md)).

| Who | Built |
|---|---|
| [Nishant Shah](https://github.com/nishantshah0) | Platform and pharmacist side: the API routes, Auth0 sign-in and roles, the event stream, the Twilio and ElevenLabs phone line, and the Pharmacy and Safety pages. Took over the voice agent (driver, prompt, tools) after its first task. Set up and ran the multi-agent build: roles, rules, the channel and the build board. |
| Priyansh Sharma | The lock: the shared contract, the 12-button control layer, the speech guard and safety check, the hammer, the stage view and phone latency. |
| [Andrew Wu](https://github.com/andrewwu13) | Red team and evals: the scenario runner and its scoring, the hijack attacks and the Safety suite redesign. Also the landing page and brand. |
| Michael (MikeyDigit) | The voice agent's start: the system prompt and fixed lines, the live Agent SDK tests and ElevenLabs voice out. |

Commits authored by "Aegis agents (on Nishant's machine)" come from agent sessions Nishant ran.

## Project docs

- [Safety rules](docs/RULES.md)
- [How safety testing works](docs/EVALS.md)
- [Product behavior target](docs/SPEC.md)
- [Brand and visual system](docs/BRAND.md)
- [Deployment and phone integration](hosting/README.md)
- [Contributor instructions](AGENTS.md)

Built at Hack Western 13 (November 2026), where it won Best Use of Auth0. Licensed under the [MIT License](LICENSE).
