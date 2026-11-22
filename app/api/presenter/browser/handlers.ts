import { createHash, createHmac } from "node:crypto";
import { forSpeech } from "@/lib/voice/spoken";
import { fail, readObject } from "../../_lib/http";
import { demoCode, equal, presenter, uuid } from "../phone/config";
import { getAudio, saveAudio } from "../phone/storage";
import { advance, browserReply } from "./conversation";
import { appendTurn, findTurn, latestTurn, openSession, type BrowserTurn } from "./storage";

const path = "/api/presenter/browser";
const privateHeaders = { "Cache-Control": "private, no-store" };
const cookieName = (sessionId: string) => "__Secure-aegis-browser-" + sessionId;
function ownershipTag(sessionId: string) {
  return createHmac("sha256", process.env.AEGIS_PRESENTER_SECRET!)
    .update("browser/owner/" + sessionId)
    .digest("base64url");
}

export function ownsSession(request: Request, sessionId: string) {
  if (!uuid.test(sessionId)) return false;
  const name = cookieName(sessionId) + "=";
  const value = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name));
  return !!value && equal(value.slice(name.length), ownershipTag(sessionId));
}

function view(row: BrowserTurn, headers: Record<string, string> = {}) {
  const { flow, session_id: sessionId, turn_id: turnId, step } = row;
  return Response.json(
    {
      sessionId,
      step,
      verified: flow.verified,
      finished: flow.phase === "end",
      ...(flow.phase === "pin" ? { demoCode: demoCode(sessionId) } : {}),
      reply: browserReply(flow),
      audioUrl: path + "/audio?" + new URLSearchParams({ sessionId, turnId }),
      refillRequested: flow.requested,
      ...(flow.appointmentBooked ? { appointmentBooked: flow.appointmentBooked } : {}),
    },
    { headers: { ...privateHeaders, ...headers } },
  );
}

export async function start(request: Request) {
  try {
    const denied = presenter(request);
    if (denied) return denied;
    const body = await readObject(request);
    if (!body || Object.keys(body).length !== 0) return fail(400, "Start with an empty JSON object.");
    const row = await openSession();
    return view(row, {
      "Set-Cookie":
        cookieName(row.session_id) +
        "=" +
        ownershipTag(row.session_id) +
        "; Path=" +
        path +
        "; HttpOnly; Secure; SameSite=Strict; Max-Age=900",
    });
  } catch {
    return fail(503, "The browser call service is unavailable.");
  }
}

export async function turn(request: Request) {
  try {
    const denied = presenter(request);
    if (denied) return denied;
    const body = await readObject(request);
    if (
      !body ||
      typeof body.sessionId !== "string" ||
      !uuid.test(body.sessionId) ||
      typeof body.turnId !== "string" ||
      !uuid.test(body.turnId) ||
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 500 ||
      (body.step !== undefined &&
        (typeof body.step !== "number" || !Number.isSafeInteger(body.step) || body.step < 0))
    )
      return fail(400, "A session ID, turn ID and short caller response are required.");
    const { sessionId, turnId, text } = body;
    if (!ownsSession(request, sessionId)) return fail(403, "This call belongs to another browser.");
    const repeated = await findTurn(sessionId, turnId);
    if (repeated) return view(repeated);
    const previous = await latestTurn(sessionId);
    if (!previous) return fail(410, "This browser call has expired. Start a new call.");
    if (previous.flow.phase === "end") return view(previous);
    if (body.step !== undefined && body.step !== previous.step)
      return fail(409, "A newer turn has already been answered.");
    const flow =
      previous.step >= 23
        ? {
            ...previous.flow,
            phase: "end" as const,
            reply: "This demo call has reached its turn limit. Goodbye.",
          }
        : await advance(sessionId, previous.flow, text);
    const row = (await appendTurn(previous, turnId, flow)) ?? (await findTurn(sessionId, turnId));
    return row ? view(row) : fail(409, "Another turn was answered first.");
  } catch {
    return fail(503, "The browser call could not answer this turn. Please retry.");
  }
}

// A clip can only voice a server-authored reply previously returned for this authenticated browser.
// Use the handset's content-addressed cache and its synthesis settings for identical spoken text.
async function voice(reply: string) {
  const text = forSpeech(reply);
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";
  const model = "eleven_flash_v2_5";
  const key = createHash("sha256")
    .update(JSON.stringify([voiceId, model, text]))
    .digest("hex");
  const cached = await getAudio(key);
  if (cached) return cached;
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("Speech unavailable");
  const result = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/" +
      encodeURIComponent(voiceId) +
      "?output_format=mp3_22050_32",
    {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: model, seed: 7 }),
    },
  );
  if (!result.ok || !result.headers.get("Content-Type")?.toLowerCase().startsWith("audio/"))
    throw new Error("Speech unavailable");
  const audio = Buffer.from(await result.arrayBuffer());
  if (!audio.length || audio.length > 1_000_000) throw new Error("Invalid audio");
  await saveAudio(key, audio);
  return audio;
}

export async function audio(request: Request) {
  try {
    const denied = presenter(request);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const sessionId = query.get("sessionId") ?? "",
      turnId = query.get("turnId") ?? "";
    if (!uuid.test(sessionId) || !uuid.test(turnId)) return fail(400, "A session and reply are required.");
    if (!ownsSession(request, sessionId)) return fail(403, "This call belongs to another browser.");
    const row = await findTurn(sessionId, turnId);
    if (!row) return fail(404, "This reply is unavailable.");
    const bytes = await voice(browserReply(row.flow));
    return new Response(new Uint8Array(bytes), {
      headers: { ...privateHeaders, "Content-Type": "audio/mpeg" },
    });
  } catch {
    return fail(503, "The audio for this reply is unavailable.");
  }
}
