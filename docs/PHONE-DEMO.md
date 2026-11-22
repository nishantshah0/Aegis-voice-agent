# Run the phone demo on any laptop

Aegis rings a real phone, and the AI talks to you through the same 12 buttons and speech guard as every other call. This is everything a laptop needs to do that: Windows, macOS or Linux.

It takes about 30 minutes the first time, and two commands after that.

---

## 1. What you need

**Software**

| What | Why | Get it |
|---|---|---|
| **Node.js 24** | runs the app | nodejs.org |
| **Git** | gets the code | git-scm.com |
| **Chrome** | the app and the patient's phone page | google.com/chrome |
| **cloudflared** | a free public address for your laptop, so Twilio can reach it | see step 3 |
| **Claude Code**, signed in | the AI on the call, with `LIVE_AGENT=1`. Or skip it and use an Anthropic API key | claude.com/claude-code |

**Accounts.** Use your own; never share a key in chat, a commit or the channel.

| Account | What you take from it |
|---|---|
| **Twilio** (a free trial is fine) | Account SID, Auth Token, the trial phone number, and **your own phone added as a verified number** |
| **Twilio Verify** (in the same Twilio account) | a Verify service id (`VA…`), so the code can be texted to you. A trial can't send other texts |
| **ElevenLabs** (free is fine) | an API key with Text to Speech access, for the voice |
| **Auth0** (the team's tenant) | only to sign in to the app's pages. Ask the team for the values, and to add your callback URL (step 5) |

---

## 2. Get the code

```bash
git clone https://github.com/nishantshah0/Aegis-voice-agent.git
cd Aegis-voice-agent
npm ci
```

---

## 3. Get cloudflared

It gives your laptop a public `https://….trycloudflare.com` address while it runs. It's free and needs no account.

- **Windows:** `winget install Cloudflare.cloudflared`, or, without admin rights, download `cloudflared-windows-amd64.exe` from github.com/cloudflare/cloudflared/releases and run it from any folder.
- **macOS:** `brew install cloudflared`
- **Linux:** the `.deb` or the binary from the same releases page.

---

## 4. Set up Twilio (once)

1. Sign up at twilio.com. The trial gives you free credit.
2. **Verify your own phone.** Go to Phone Numbers → Manage → Verified Caller IDs → Add, and type in the code you're sent. A trial can only call verified numbers.
3. **Get a number.** Go to Phone Numbers → Manage → Buy a number, and pick one with Voice. Some trials use a shared trial number instead; your Twilio console shows it. If the form asks for a TwiML URL, `http://demo.twilio.com/docs/voice.xml` is fine: our server sends its own instructions on every call it makes.
4. **Make a Verify service.** Go to Verify → Services → Create, set the code length to 6, and copy the `VA…` id.
5. Copy the **Account SID** and **Auth Token** from the console home page.

---

## 5. Make `.env`

```bash
cp .env.example .env
```

Fill these in yourself. `.env` is git-ignored: never commit it.

```
# The AI
LIVE_AGENT=1                    # uses this laptop's Claude Code login (or set ANTHROPIC_API_KEY instead)
AGENT_THINKING=off              # faster replies; the lock holds either way

# The voice
ELEVENLABS_API_KEY=...

# The phone line
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...       # the Twilio number
TEST_PATIENT_PHONE=+1...        # YOUR phone, verified in Twilio: this is the phone that rings
TWILIO_VERIFY_SERVICE_SID=VA...
ELEVENLABS_AGENT_ID=any-value   # needed by the check, not used on a trial (see note below)
VOICE_LLM_URL=https://<tunnel>.trycloudflare.com/api/voice/llm   # set in step 6

# The app
DEMO_CONTROLS=on                # Demo menu and the call button work on this laptop
APP_BASE_URL=http://localhost:3000,https://<tunnel>.trycloudflare.com
AUTH0_DOMAIN=...                # from the team
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=...                # any 64 hex characters: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Leave `DATABASE_URL` empty.** The app then runs on its own private in-memory data, so your test calls and **Reset demo** never touch the team's shared database.

**`ELEVENLABS_AGENT_ID`** is only used by the paid streaming mode (`VOICE_TWILIO_STREAM=1`). On a trial, any value passes the check.

**Auth0:** ask the team to add `http://localhost:3000/api/auth/callback` to the Auth0 app's Allowed Callback URLs, and to give your login the `pharmacist` role. Without sign-in, you can still place calls with the commands in step 7.

---

## 6. Start it (every time)

Open two terminals in the `Aegis-voice-agent` folder.

**Terminal 1: the tunnel**

```bash
cloudflared tunnel --no-autoupdate --url http://localhost:3000
```

It prints an address like `https://some-random-words.trycloudflare.com`. Put it in `.env`, in both lines that say `<tunnel>`:

```
VOICE_LLM_URL=https://some-random-words.trycloudflare.com/api/voice/llm
APP_BASE_URL=http://localhost:3000,https://some-random-words.trycloudflare.com
```

**The address changes every time cloudflared restarts.** Update these two lines whenever it does.

**Terminal 2: the app**

```bash
npm run dev
```

Open http://localhost:3000.

---

## 7. Make it call you

**From the app** (signed in):

1. Open any page under **Pharmacy** or **Safety**.
2. Click **Demo** in the top bar, then **Reset demo**. A patient can only be called once every 3 days, so reset before each call.
3. Click **Call Sam on a real phone**.

**From a terminal** (no sign-in needed, with `DEMO_CONTROLS=on`):

```bash
curl -X POST http://localhost:3000/api/demo/reset
curl -X POST http://localhost:3000/api/voice/outbound
```

**On the call**, you play the made-up patient Sam Rivera:

1. Twilio's trial message plays first: press a key if it asks.
2. Aegis greets you and texts a 6-digit code to your phone. Read it out.
3. Give Sam's date of birth: **March 14, 1990**.
4. Ask for the Concerta refill. Mention a side effect, or try to talk it into saying "approved".

Everything you say shows up live in **Pharmacy → Calls**, with the full record. The refill waits in **Today**, and side effects go to **Review**.

---

## 8. If something goes wrong

| What you see | What to do |
|---|---|
| `409 … rule 7d` | Sam was called in the last 3 days: **Reset demo**, then call again |
| `502 … error 573002` | Your phone isn't verified in **this** Twilio account: add it under Verified Caller IDs |
| `503 … needs … in .env` | It lists the `.env` names that are still empty |
| The call connects, then silence | The tunnel restarted: update `VOICE_LLM_URL` and `APP_BASE_URL`, then restart `npm run dev` |
| No text with the code | Set `TWILIO_VERIFY_SERVICE_SID`. Trials can't send any other text (Twilio error 572006) |
| "Auth0 isn't configured" | Fill in the four `AUTH0_*` values, or use the terminal commands in step 7 |
| Sign-in fails with a callback error | Ask the team to add your callback URL in Auth0 (step 5) |
| Replies feel slow | Set `AGENT_THINKING=off`. Optional: `VOICE_FILLER_MS=1500` says "One moment." when a reply takes longer than that |

---

## 9. Good to know

- **Your laptop must stay on**, with both terminals running, for the whole call.
- **Costs:** Twilio trial credit per call, ElevenLabs characters per reply, and your Claude plan (or API key) for the AI. A test call costs cents.
- **The paid upgrade:** a paid Twilio account and `VOICE_TWILIO_STREAM=1` stream the call through ElevenLabs Agents. It's faster, with natural turn-taking. Setup is in `hosting/README.md`, "Real phone calls".
- **To skip the tunnel for good:** deploy to a server with `hosting/README.md`, so the app has a permanent address.
