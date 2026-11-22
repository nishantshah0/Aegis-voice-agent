# Hosting Refill Guard on Vultr with https (task 2.6)

One Ubuntu server on Vultr runs the app behind Caddy, which gets and renews the https certificate on its own. Phones need https for the microphone, so this is what the demo runs on. Until it's up, the Cloudflare quick tunnel works too (pages fall back to polling there).

```
phone / laptop ──https──▶ Caddy (:443, automatic certificate) ──▶ Next.js on 127.0.0.1:3000 ──▶ Tiger Data Postgres
```

## What you need

- The MLH Vultr code (credit) and the GoDaddy Registry domain code.
- This repository on your laptop, with a working `.env`.
- An SSH key on your laptop (`~/.ssh/id_ed25519.pub`). Make one with `ssh-keygen -t ed25519` if you don't have one.

## 1. Create the server on Vultr

1. Sign in at vultr.com and redeem the MLH code under **Billing**.
2. **Deploy** a **Cloud Compute** server: Ubuntu 24.04, 2 GB RAM or more (the build needs it), a region near the venue.
3. Add your SSH public key under **SSH Keys**, and tick it on the deploy page.
4. Note the server's **IPv4 address**.

## 2. Point the domain at it (GoDaddy)

1. Redeem the domain code, then open the domain's **DNS** settings.
2. Add an **A** record: name `@` (or a subdomain such as `refill`), value the server's IPv4 address, TTL 600.
3. Wait until `dig +short <your domain>` prints the IP. Caddy can't get a certificate before that.

## 3. Set up the server (once)

```bash
scp hosting/setup-server.sh root@<server-ip>:
ssh root@<server-ip> 'DOMAIN=<your domain> bash setup-server.sh'
```

It installs Node.js 24 (checksum checked), Caddy, a `refill-guard` systemd service bound to `127.0.0.1:3000`, and a firewall that allows only SSH, http and https.

## 4. Prepare `.env` for the server

The server reads `.env` from the app folder. Start from your laptop's `.env` and change:

| Variable | On the server |
|---|---|
| `APP_BASE_URL` | `https://<your domain>` (add `,http://localhost:3000` only if you also run it locally) |
| `DEMO_CONTROLS` | leave it out: on a public address, reset and the clock stay staff-only |
| `DATABASE_URL` | the Tiger Data URL; the CA in `certs/tiger-cloud-ca.pem` verifies it |
| `LIVE_AGENT` / `ANTHROPIC_API_KEY` | as for the demo; `LIVE_AGENT=1` also needs Claude Code signed in on the server |

`deploy.sh --env` copies `.env` over SSH and makes it readable only by the app. It never goes into git.

## 5. Tell Auth0 about the new address

In the Auth0 dashboard, **Applications → Refill Guard console → Settings**:

- **Allowed Callback URLs**: add `https://<your domain>/api/auth/callback`
- **Allowed Logout URLs**: add `https://<your domain>`

(Role 2's agent can make this change through the Management API if you'd rather.)

## 6. Deploy

From the repository root:

```bash
HOST=root@<server-ip> DOMAIN=<your domain> bash hosting/deploy.sh --env
```

It copies the code (no `node_modules`, `.git`, `.env` unless `--env`), runs `npm ci` and `npm run build` on the server, restarts the service, and checks `https://<your domain>/api/clock`. Later deploys can leave out `--env`.

## 7. Before the demo

- Open `https://<your domain>/console/today`, sign in, and press **Pair a patient's phone** for Sam. Open the link on the judge's phone within 10 minutes.
- Press **Reset demo**, then **Run daily check**: the paired phone rings.
- Allow the microphone on the phone when `/phone` asks.

## When something's wrong

| Symptom | Look at |
|---|---|
| `deploy.sh` says "Not up yet" | `ssh root@<ip> journalctl -u refill-guard -n 50` |
| Browser warns about the certificate | `ssh root@<ip> journalctl -u caddy -n 50` (usually DNS not pointing at the server yet) |
| Sign-in fails with "callback URL mismatch" | Step 5 |
| Live events stop | Caddy's `flush_interval -1` is in `/etc/caddy/Caddyfile`; pages also fall back to polling |

## Real phone calls (Trail #70)

A real phone can call the pharmacy, and the pharmacy can call Sam's stand-in phone. ElevenLabs Agents answers the phone through a Twilio number and does speech to text and text to speech. **Our server is its only LLM**: ElevenLabs posts each turn to `/api/voice/llm`, the caller's words go through the same driver as `/phone` (safety check, the 12 buttons, `guardSentence`), and ElevenLabs speaks only the guarded lines that come back. Phone calls land in the same store and record, so they show up in the console and the Safety suite like any other call.

```
phone ──▶ Twilio number ──▶ ElevenLabs Agents (speech in/out) ──https──▶ /api/voice/llm ──▶ AgentDriver ──▶ control.press + guardSentence
```

### Once: accounts and `.env`

1. **Twilio.** A trial account gives one free number. Buy it under **Phone Numbers → Manage → Buy a number** (it must show under **Active numbers**; a number you only verified doesn't count). Trial accounts only call and take calls from **verified** numbers (up to 5): add each teammate's phone under **Verified Caller IDs**. Callers hear a short trial notice first.
2. Put these in `.env` yourself (never in code, commits or the channel):

   | Variable | What |
   |---|---|
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio console home page |
   | `TWILIO_PHONE_NUMBER` | the number you bought, `+1...` |
   | `TEST_PATIENT_PHONE` | the verified phone that plays Sam, `+1...` |
   | `VOICE_LLM_SECRET` | any long random string: `openssl rand -hex 24` |
   | `ELEVENLABS_VOICE_ID` | optional, the same voice as `/phone` |
   | `DEMO_CONTROLS` | `on` on the demo laptop, so the button works without signing in |
| `TWILIO_VERIFY_SERVICE_SID` | optional, a trial account's way to text the code: create a Verify service (Console → Verify → Services, code length 6) and paste its `VA…` id |
| `AGENT_THINKING` | optional, `off` to skip the agent's hidden reasoning on each reply: the biggest part of a phone turn's delay. The 12 buttons and `guardSentence` hold either way |

3. Start the app, then a public https URL for it (a Cloudflare quick tunnel is enough tonight; on the Vultr server use its own domain instead):

   ```bash
   npm run dev
   cloudflared tunnel --no-autoupdate --url http://localhost:3000
   ```

   Put `VOICE_LLM_URL=https://<the trycloudflare host>/api/voice/llm` in `.env`. A quick tunnel's address changes every time it starts, so after a restart set it again and re-run the script below.

4. Create (or update) the ElevenLabs agent and import the Twilio number:

   ```bash
   node scripts/elevenlabs-agent.ts --write-env
   ```

   It stores `VOICE_LLM_SECRET` as an ElevenLabs secret (sent back to us as `Authorization: Bearer ...`), makes the agent with `custom-llm` pointed at `VOICE_LLM_URL`, the fixed greeting as its first message, only the `end_call` tool, no fillers, and sign-in required for web conversations. It imports the Twilio number and saves `ELEVENLABS_LLM_SECRET_ID`, `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID` to `.env`. It prints ids only. `--dry-run` shows the config and changes nothing.

5. Restart `npm run dev` so the server reads the new `.env`.

### A Twilio trial's shared number

A new Twilio trial may give the account a shared "From" number that it doesn't own (Active numbers is empty), and ElevenLabs can't import that. Leave `ELEVENLABS_PHONE_NUMBER_ID` empty: `/api/voice/outbound` then places the call with Twilio's REST API, sending only `To`, `From`, `Url` and `StatusCallback` (a trial refuses `Method`, `StatusCallbackMethod`, `StatusCallbackEvent` and `Twiml`).

A trial also won't run `<Connect><Stream>`, so by default no ElevenLabs agent sits on the call. Each turn is plain TwiML instead: `/api/voice/twiml` plays the guarded opener and starts a `<Gather input="speech">`; `/api/voice/turn` sends what Twilio heard through the same driver turn (safety check, the 12 buttons, `guardSentence`) and `<Play>`s only the guarded lines in the ElevenLabs voice (`/api/voice/clip`), or `<Say>`s the same words if the voice fails. A first silence gets "Are you still there?", a second one hangs up. Twilio's URLs carry a per-call token (a trial's fetch isn't signed with our auth token); the status callback (`/api/voice/twilio-status`) must carry Twilio's signature, and it ends our side when the call ends. With a paid account, `VOICE_TWILIO_STREAM=1` uses ElevenLabs' stream instead (register-call, u-law 8000 audio). A trial only calls verified numbers: a refusal comes back with Twilio's code and message, numbers hidden.

The verification code goes by text when the number can send texts. Otherwise it shows on the patient's paired `/phone` page (served by the same server), and the agent says "I've sent a code to the phone we have on file."

### Faster turns on a trial

Each turn plays its reply inside the `<Gather>`, so the caller can talk over it, and ends their turn after a 1-second pause (`speechModel="phone_call"`). Every guarded line is voiced the moment the driver says it, and a line said before plays from a cache. A turn that's still thinking after `VOICE_FILLER_MS` (1200 ms) says the guarded filler line "One moment." and redirects to `/api/voice/turn?cont=1`, which plays the same turn's answer.

With `TWILIO_VERIFY_SERVICE_SID` set, the code goes by Twilio Verify (a trial can't send other texts). When the caller reads it back, Verify checks it, and only an approved code is swapped for the lock's own code before the agent hears the line; a wrong one reaches the lock as said and fails there.

### Calls

- **Inbound:** call the Twilio number from a verified phone. You hear the greeting, then talk to the pharmacy agent: ask for a refill, or try to trick it.
- **Outbound:** open the **Demo** menu in the app's top bar and press **Call Sam on a real phone** (or `curl -X POST http://localhost:3000/api/voice/outbound` with `DEMO_CONTROLS=on`). Rule 7 decides first (opt-in, calling hours, frequency), like **Call now**. `TEST_PATIENT_PHONE` rings; when it's answered, the agent says the outbound opener and a code goes to the phone on file, which is a **text message to `TEST_PATIENT_PHONE`** through Twilio. Read the code back with Sam's date of birth (1990-03-14) to verify.
- Each conversation becomes one call. Outbound calls carry our call id (`custom_llm_extra_body.aegis_call_id`); inbound ones are known by the `[aegis-conversation:{{system__conversation_id}}]` tag in the agent's prompt.

### Check it without a phone

```bash
curl -N -X POST http://localhost:3000/api/voice/llm/chat/completions \
  -H "Authorization: Bearer $VOICE_LLM_SECRET" -H "Content-Type: application/json" \
  -d '{"stream":true,"messages":[{"role":"system","content":"[aegis-conversation:conv_try_1]"},{"role":"user","content":"Are you open Sunday?"}]}'
```

Set `VOICE_LLM_DEBUG=1` to log each request's shape (path, body keys, message roles, call id; never what was said).

### When something's wrong

| Symptom | Look at |
|---|---|
| Script: "not found in your Twilio account" | `TWILIO_PHONE_NUMBER` must be a number the account **owns** (Active numbers), with that account's SID and token |
| The call connects, then silence or "something went wrong" | The tunnel restarted: new `VOICE_LLM_URL`, re-run the script. Then check that `VOICE_LLM_SECRET` matches what the script stored |
| `/api/voice/outbound` says 503 | It lists the `.env` names still missing |
| 409 "rules won't ring Sam" | Rule 7: outside calling hours or called too recently. **Reset demo** first |
| The agent says it hit its limit | The live agent's hourly cap (`results/agent-usage.jsonl`); same as `/phone` |
| No text with the code | Twilio trial texts only verified numbers; check `TWILIO_*` and `TEST_PATIENT_PHONE` |

### AI against AI over real phones (not built)

Role 3's attacker could call our number as a second ElevenLabs agent. It needs a **second Twilio number** (a paid account, or a second trial) and an endpoint like `/api/voice/attacker` that runs `createSdkAttacker` the way `/api/arena/live` does, behind a flag such as `VOICE_ATTACKER=1`. The attacker agent would place an outbound call from the second number to our pharmacy number. Our side needs no change: it's an inbound call like any other.
