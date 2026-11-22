import { forSpeech } from "@/lib/voice/spoken";
import { refuseUnlessStaff } from "../../../../_lib/arena-runs";
import { fail, readObject } from "../../../../_lib/http";
import { readLiveCall } from "../../../../_lib/live-calls";
import { replaySpeech } from "../../../../_lib/replay-speech";

// POST /api/arena/live/:id/speak { seq, say? } → audio/mpeg (Trail #69, Role 2 stand-in)
// The sibling of Role 1's /api/call/:id/speak for live attack calls, which run on their own
// store. It voices only what was said on that call, from the saved turns: a caller line in
// the attacker's voice, a line the guard passed in the pharmacy's voice, and (say:
// "replacement") the line said instead of a blocked one. A blocked line itself is never
// voiced. Same ElevenLabs model and the same hourly character budget as the speak route;
// the key never leaves the server.

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  const { id } = await ctx.params;
  const call = await readLiveCall(id);
  if (!call) return fail(404, "No such live call");
  const body = await readObject(request);
  const turn = call.turns.find((t) => t.seq === body?.seq);
  if (!turn) return fail(404, "No such turn on this call");

  let text: string;
  let speaker: "pharmacy" | "caller";
  if (turn.kind === "line_blocked") {
    if (body?.say !== "replacement") return fail(403, "A blocked line is never voiced");
    [text, speaker] = [turn.replacement ?? "", "pharmacy"];
  } else if (turn.kind === "safety" && body?.say === "replacement") {
    [text, speaker] = [turn.replacement ?? "", "pharmacy"];
  } else if (turn.kind === "caller_line" || turn.kind === "safety") {
    [text, speaker] = [turn.text ?? "", "caller"];
  } else if (turn.kind === "line_spoken") {
    [text, speaker] = [forSpeech(turn.text ?? ""), "pharmacy"];
  } else {
    return fail(400, "Nothing was said in this turn");
  }
  return replaySpeech(`live_${id}`, speaker, text, request.signal);
}
