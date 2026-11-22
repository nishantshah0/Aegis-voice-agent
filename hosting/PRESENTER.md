# Hosted presenter demo

Production runs in the aegis-pharmacy-live-hw13 Vercel project. The presenter desk starts one outbound Twilio call to a fixed test handset, runs seven isolated pharmacy workflow checks, and streams three live Claude evaluations. ElevenLabs voices are available on the real call and the individual test player. The seeded patient directory and pharmacy workspace are available after presenter sign-in.

[Open the presenter desk](https://aegis-pharmacy-live-hw13.vercel.app/present)

The presenter passcode is distributed separately. The server issues a secure, HTTP-only expiring cookie after a same-origin login. The Next.js proxy validates the session and supplies a server-only proof to the presenter endpoints. Public callback paths validate Twilio signatures or scoped signed callback URLs. The real dial accepts no destination parameter. An operator must press the dial control. Store provider keys as production environment variables in the Vercel project.

Use AEGIS_PUBLIC_ORIGIN, AEGIS_PRESENTER_SECRET, AEGIS_PRESENTER_PASSCODE, PATIENT_SIMULATION=community-demo and AEGIS_DEMO_STORAGE_URL. Supply ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and TEST_PATIENT_PHONE. The demo database login needs access to the dedicated aegis_demo schema, with its search_path set to that schema. The public Tiger CA in certs/ is included in function traces. Set APP_BASE_URL to the same HTTPS origin. Synthetic data initializes in the demo schema. Hosted demo credentials belong in the provider's secret manager.

Real-call state and signed audio data live in PostgreSQL so that callbacks work across Vercel function instances. Run archives hold redacted transcripts and verdicts. A failed verdict is a completed test. A transport or provider error is an interrupted test. The patient handset sees its own test call only. The presenter shows the per-call demo code during verification.

The deployed environment runs fixed business evaluations. The public Entire judging page remains available for synthetic audio playback and benchmark evidence. Neither page requires the presenter's laptop to be running.
