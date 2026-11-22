import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { replayLines, type ReplayEntry, type ReplayLine } from "@/lib/voice/replay";

type Ticket = { call: string; expires: number; speaker: ReplayLine["speaker"]; text: string };

function signature(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update("aegis/replay/v1\0").update(payload).digest();
}

// Callers sign either staff-authorized records or public synthetic test lines. Each endpoint checks its audience.
export function replayTickets(source: string, entries: ReplayEntry[]): Record<number, string> | undefined {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return undefined;
  const call = createHash("sha256").update(source).digest("hex");
  const expires = Date.now() + 60 * 60 * 1000;
  return Object.fromEntries(replayLines(entries).map(({ seq, speaker, text }) => {
    const payload = Buffer.from(JSON.stringify({ call, expires, speaker, text } satisfies Ticket)).toString("base64url");
    return [seq, payload + "." + signature(payload, key).toString("base64url")];
  }));
}

export function verifiedReplayTicket(raw: unknown, key: string): Ticket | null {
  if (typeof raw !== "string" || raw.length > 16_384) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  const expected = signature(payload, key);
  const provided = Buffer.from(mac, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const ticket: Ticket = JSON.parse(Buffer.from(payload, "base64url").toString());
    return ticket.expires > Date.now() ? ticket : null;
  } catch { return null; }
}
