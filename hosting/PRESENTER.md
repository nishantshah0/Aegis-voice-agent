# Hosted presenter demo

Production runs in the aegis-pharmacy-live-hw13 Vercel project. Sign-in opens the pharmacy dashboard at /app. The Phone page handles browser conversations and outbound calls to the fixed test handset. The Business tests page runs seven isolated pharmacy workflow checks and streams six selectable live Claude evaluations, sequentially or two at a time. ElevenLabs voices are available on the real call and the individual test player. The seeded patient directory and pharmacy workspace are available after presenter sign-in.

[Open the pharmacy dashboard](https://aegis-pharmacy-live-hw13.vercel.app/app)

The presenter passcode is distributed separately. The server issues a secure, HTTP-only expiring cookie after a same-origin login. The Next.js proxy validates the session and supplies a server-only proof to the presenter endpoints. Public callback paths validate Twilio signatures or scoped signed callback URLs. The real dial accepts no destination parameter. An operator must press the dial control. Store provider keys as production environment variables in the Vercel project.

Use AEGIS_PUBLIC_ORIGIN, AEGIS_PRESENTER_SECRET, AEGIS_PRESENTER_PASSCODE, PATIENT_SIMULATION=community-demo and AEGIS_DEMO_STORAGE_URL. Supply ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and TEST_PATIENT_PHONE. The demo database login needs access to the dedicated aegis_demo schema, with its search_path set to that schema. The public Tiger CA in certs/ is included in function traces. Set APP_BASE_URL to the same HTTPS origin. Synthetic data initializes in the demo schema. Hosted demo credentials belong in the provider's secret manager.

Real-call state and signed audio data live in PostgreSQL so that callbacks work across Vercel function instances. Run archives hold redacted transcripts and verdicts. A failed verdict is a completed test. A transport or provider error is an interrupted test. The patient handset sees its own test call only. The presenter shows the per-call demo code during verification.

The deployed environment runs fixed business evaluations. The public Entire judging page remains available for synthetic audio playback and benchmark evidence. Neither page requires the presenter's laptop to be running.

The public homepage serves the redesign. Take the Call opens the dashboard’s Phone page. To talk in the browser, start a conversation, allow the microphone, record a reply and send it. The browser sends each recording for ElevenLabs transcription and plays the pharmacy's voiced response. Typed replies and audio replay are also available. Browser conversations run independently of handset calls. Use fictional information throughout the demo.

Deploy this hosted demo with `hosting/deploy-presenter.sh` from the linked project directory. The demo uses AEGIS_DEMO_STORAGE_URL. The deployment explicitly clears DATABASE_URL and selects the community-demo fixture. The scripted-call API rejects a general database binding. Verify each selected scripted call returns a verdict, then load its saved replay. The rule workflow checks exercise a separate endpoint.
