import { createHash, randomUUID } from "node:crypto";
import { forSpeech } from "@/lib/voice/spoken";
import { fail } from "../../_lib/http";
import { signedTwilioFields } from "../../_lib/twilio";
import {
  callSid,
  clipToken,
  demoCode,
  equal,
  origin,
  prefix,
  presenter,
  ready,
  turnToken,
  uuid,
} from "./config";
import { DEMO_PATIENT, DEMO_PATIENT_INBOUND } from "../agent/agent";
import { assistantOf, nextTurn, openFlow } from "../agent/turn";
import {
  getAudio,
  getCall,
  isActive,
  reserve,
  saveAudio,
  setFirstFlow,
  turn,
  updateState,
  type PhoneRow,
  type State,
} from "./storage";

const providerStates: Record<string, State> = {
  queued: "queued",
  initiated: "queued",
  ringing: "ringing",
  answered: "in-progress",
  "in-progress": "in-progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  failed: "failed",
  canceled: "canceled",
};
const details: Record<State, string> = {
  starting: "Preparing the test call.",
  queued: "Twilio accepted the test call.",
  ringing: "The test phone is ringing.",
  "in-progress": "The phone answered. Follow the spoken demo prompts.",
  completed: "Twilio marked the call complete.",
  busy: "The test phone was busy.",
  "no-answer": "The test phone did not answer.",
  canceled: "The provider canceled the call.",
  failed:
    "Twilio could not complete the call. Check the account’s voice permissions and verified test destination.",
  unconfirmed:
    "The provider did not confirm the dial request. Check the Twilio call log before starting another call.",
};
const inboundAgent = (flow: PhoneRow["flow"]) => flow.mode === "agent" && flow.callKind === "inbound";
function view(row: PhoneRow) {
  const stale = isActive(row.status) && Date.now() - new Date(row.created_at).getTime() > 5 * 60_000;
  const status = stale ? "unconfirmed" : row.status;
  return Response.json(
    {
      callId: row.id,
      status,
      updatedAt: row.updated_at,
      message: details[status] + (row.provider_error ? ` Provider code ${row.provider_error}.` : ""),
      ...(isActive(status) && !stale && !row.flow.verified && !(inboundAgent(row.flow) && !row.flow.codeSent) ? { demoCode: demoCode(row.id) } : {}),
      // Trail #70: which assistant is answering, who it's for until they're verified, and why a call is inbound.
      assistant: assistantOf(row.flow),
      ...(row.flow.mode === "agent" ? { callKind: row.flow.callKind ?? "outbound" } : {}),
      ...(row.flow.notice ? { notice: row.flow.notice } : {}),
      ...(isActive(status) && !stale && !row.flow.verified && row.flow.mode === "agent" ? { demoPatient: inboundAgent(row.flow) ? DEMO_PATIENT_INBOUND : DEMO_PATIENT } : {}),
      refillRequested: row.flow.requested,
      appointmentBooked: row.flow.appointmentBooked,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
const auth = () =>
  "Basic " +
  Buffer.from(process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64");
const callsUrl = () =>
  "https://api.twilio.com/2010-04-01/Accounts/" +
  encodeURIComponent(process.env.TWILIO_ACCOUNT_SID!) +
  "/Calls";
const callback = (route: string, id: string) =>
  origin() + prefix + "/" + route + "?callId=" + encodeURIComponent(id);
function turnUrl(row: PhoneRow, step: number) {
  const expires = String(Math.floor(new Date(row.created_at).getTime() / 1000) + 300);
  return (
    callback("twiml", row.id) +
    "&step=" +
    step +
    "&expires=" +
    expires +
    "&t=" +
    turnToken(row.id, step, expires)
  );
}
const safeProviderCode = (value: unknown) => (/^\d{1,6}$/.test(String(value)) ? String(value) : undefined);

export async function start(request: Request) {
  try {
    const denied = presenter(request);
    if (denied) return denied;
    if (!ready()) return fail(503, "The presenter phone configuration is incomplete.");
    const payload = await request.text();
    if (payload.trim() && payload.trim() !== "{}")
      return fail(400, "This endpoint calls only the configured test phone.");
    const key = request.headers.get("Idempotency-Key") ?? randomUUID();
    if (!uuid.test(key)) return fail(400, "Idempotency-Key must be a UUID.");
    const claim = await reserve(key);
    if (!claim) return fail(429, "Six demo calls have started this hour. Try later.");
    if (!claim.dial) return view(claim.row);
    const { id } = claim.row;
    // The agent's guarded opener is ready before Twilio dials, so step 0 only plays it.
    claim.row = (await setFirstFlow(id, await openFlow(id, "phone"))) ?? claim.row;
    const body = new URLSearchParams({
      From: process.env.TWILIO_PHONE_NUMBER!,
      To: process.env.TEST_PATIENT_PHONE!,
      Url: turnUrl(claim.row, 0),
      StatusCallback: callback("event", id),
    });
    let sid: string | undefined,
      status: State = "unconfirmed",
      reason: string | undefined;
    try {
      const r = await fetch(callsUrl() + ".json", {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await r.json();
      if (r.ok && typeof result.sid === "string" && callSid.test(result.sid)) {
        sid = result.sid;
        status = "queued";
      } else if (r.status >= 400 && r.status < 500) {
        status = "failed";
        reason = safeProviderCode(result.code);
      }
    } catch {
      /* An ambiguous network result must never trigger a second dial. */
    }
    const updated = await updateState(id, sid, status, reason);
    return view(updated ?? claim.row);
  } catch {
    return fail(
      503,
      "The presenter call service is unavailable. Check its secure configuration and database.",
    );
  }
}

export async function status(request: Request) {
  try {
    const denied = presenter(request);
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get("callId") ?? "";
    if (!uuid.test(id)) return fail(400, "A valid call ID is required.");
    let row = await getCall(id);
    if (!row) return fail(404, "No such presenter call.");
    if (row.sid && isActive(row.status) && Date.now() - new Date(row.updated_at).getTime() > 12_000) {
      try {
        const provider = await fetch(callsUrl() + "/" + encodeURIComponent(row.sid) + ".json", {
          headers: { Authorization: auth() },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(3500),
        });
        if (provider.ok) {
          const result = await provider.json();
          const state = Object.hasOwn(providerStates, result.status)
            ? providerStates[result.status]
            : undefined;
          if (state && result.sid === row.sid)
            row = (await updateState(id, row.sid, state, safeProviderCode(result.error_code))) ?? row;
        }
      } catch {
        /* The most recent authenticated webhook remains authoritative. */
      }
    }
    return view(row);
  } catch {
    return fail(503, "Could not load the presenter call status.");
  }
}
async function signed(request: Request, allowTrialRelay = false) {
  const url = new URL(request.url);
  const id = url.searchParams.get("callId") ?? "";
  if (!uuid.test(id)) return;
  // The One Console trial relay can sign a Gather request with its own account.
  // Each relayed action carries our short-lived HMAC for this call and exact step.
  // Use the original REST call SID in storage, since a relay can supply a child SID.
  if (allowTrialRelay && url.searchParams.has("t")) {
    const step = url.searchParams.get("step") ?? "",
      expires = url.searchParams.get("expires") ?? "";
    if (
      !/^\d{1,2}$/.test(step) ||
      !/^\d{10}$/.test(expires) ||
      Number(expires) * 1000 < Date.now() ||
      !equal(url.searchParams.get("t") ?? "", turnToken(id, Number(step), expires))
    )
      return;
    const row = await getCall(id);
    if (!row) return;
    const fields = Object.fromEntries(new URLSearchParams(await request.text()));
    const sid =
      row.sid ?? (fields.AccountSid === process.env.TWILIO_ACCOUNT_SID ? fields.CallSid : undefined);
    if (!sid || !callSid.test(sid)) return;
    return { fields, id, sid, url };
  }
  const fields = await signedTwilioFields(request, { ...process.env, VOICE_PUBLIC_URL: origin() });
  if (!fields || fields.AccountSid !== process.env.TWILIO_ACCOUNT_SID || !callSid.test(fields.CallSid ?? ""))
    return;
  return { fields, id, sid: fields.CallSid, url };
}
export async function event(request: Request) {
  try {
    const call = await signed(request);
    if (!call) return fail(403, "Invalid provider signature.");
    const state = Object.hasOwn(providerStates, call.fields.CallStatus)
      ? providerStates[call.fields.CallStatus]
      : undefined;
    if (!state) return fail(400, "Unknown call status.");
    const row = await updateState(call.id, call.sid, state, safeProviderCode(call.fields.ErrorCode));
    return new Response(null, { status: row ? 204 : 404 });
  } catch {
    return fail(503, "Could not record the call status.");
  }
}
const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const response = (text: string) =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + text + "</Response>", {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
async function voiced(row: PhoneRow) {
  const voice = process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";
  const text = forSpeech(row.flow.reply),
    model = "eleven_flash_v2_5";
  const key = createHash("sha256")
    .update(JSON.stringify([voice, model, text]))
    .digest("hex");
  try {
    if (!(await getAudio(key))) {
      const r = await fetch(
        "https://api.elevenlabs.io/v1/text-to-speech/" +
          encodeURIComponent(voice) +
          "?output_format=mp3_22050_32",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY! },
          redirect: "error",
          signal: AbortSignal.timeout(5500),
          body: JSON.stringify({ text, model_id: model, seed: 7 }),
        },
      );
      if (!r.ok) throw new Error("Speech unavailable");
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!bytes.length || bytes.length > 1_000_000) throw new Error("Invalid audio");
      await saveAudio(key, bytes);
    }
    return (
      "<Play>" +
      xml(callback("clip", row.id) + "&key=" + key + "&token=" + clipToken(row.id, key)) +
      "</Play>"
    );
  } catch {
    return "<Say>" + xml(text) + "</Say>";
  }
}
export async function twiml(request: Request) {
  try {
    const call = await signed(request, true);
    if (!call) return fail(403, "Invalid provider signature.");
    const raw = call.url.searchParams.get("step") ?? "0";
    if (!/^\d{1,2}$/.test(raw)) return fail(400, "Invalid call step.");
    const step = Number(raw);
    const linked = await updateState(call.id, call.sid, "in-progress");
    if (!linked || !isActive(linked.status)) return response("<Hangup/>");
    const row = await turn(call.id, call.sid, step, (s) =>
      nextTurn(
        call.id,
        s,
        (call.fields.Digits ?? "").slice(0, 8),
        (call.fields.SpeechResult ?? "").slice(0, 300),
        "phone",
      ),
    );
    if (!row) return response("<Hangup/>");
    const spoken = await voiced(row);
    if (row.flow.phase === "end") return response(spoken + "<Hangup/>");
    const next = xml(turnUrl(row, row.step + 1));
    const options =
      row.flow.phase === "pin"
        ? 'input="speech dtmf" numDigits="6" speechTimeout="2"'
        : row.flow.phase === "agent"
          ? 'input="speech dtmf" speechTimeout="auto" finishOnKey="#"'
          : 'input="speech dtmf" numDigits="1" speechTimeout="auto"';
    const outside = row.flow.phase === "appointment";
    return response(
      (outside ? spoken : "") +
        "<Gather " +
        options +
        ' method="POST" timeout="7" actionOnEmptyResult="true" action="' +
        next +
        '">' +
        (outside ? "" : spoken) +
        "</Gather>",
    );
  } catch {
    return response("<Say>The demonstration is temporarily unavailable. Goodbye.</Say><Hangup/>");
  }
}
export async function clip(request: Request) {
  try {
    const u = new URL(request.url),
      id = u.searchParams.get("callId") ?? "",
      key = u.searchParams.get("key") ?? "",
      token = u.searchParams.get("token") ?? "";
    if (!uuid.test(id) || !/^[a-f0-9]{64}$/.test(key) || !equal(token, clipToken(id, key)))
      return fail(403, "Invalid audio link.");
    const row = await getCall(id);
    if (!row || Date.now() - new Date(row.created_at).getTime() > 10 * 60_000)
      return fail(404, "Audio link expired.");
    const bytes = await getAudio(key);
    if (!bytes) return fail(404, "Clip unavailable.");
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
    });
  } catch {
    return fail(503, "Audio unavailable.");
  }
}
