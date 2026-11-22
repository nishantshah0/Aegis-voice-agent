import { connection } from "next/server";
import { getApprover } from "@/lib/auth/session";
import { recordedConversation } from "../../../_lib/call-recording";
import { fail } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

// The provider recording is optional. Only use the association established by the phone line.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  if (!(await getApprover())) return fail(401, "Sign in to play the call recording");
  const { id } = await ctx.params;
  const store = getStore();
  const call = await store.getCall(id);
  if (!call || call.state !== "ended") return fail(404, "No finished call recording");
  const conversation = recordedConversation(await store.listRecord(id));
  const key = process.env.ELEVENLABS_API_KEY;
  if (!conversation || !key) return fail(404, "No original recording available");
  const headers = new Headers({ "xi-api-key": key });
  const range = request.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("Range", range);
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversation)}/audio`, {
      headers, signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]), redirect: "error", cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) return fail(404, "No original recording available");
    const output = new Headers({ "Content-Type": upstream.headers.get("content-type")?.startsWith("audio/") ? upstream.headers.get("content-type")! : "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) output.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    return fail(502, "Could not load the recording");
  }
}
