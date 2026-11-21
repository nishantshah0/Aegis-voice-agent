import { connection } from "next/server";
import { now, setClock } from "@/lib/events";
import { fail, ok, readObject } from "../_lib/http";

// GET /api/clock: the demo clock. POST /api/clock { now: ISO time }: set it,
// which also sends a "clock" event to every page.
export async function GET() {
  await connection();
  return ok({ now: now() });
}

export async function POST(request: Request) {
  const body = await readObject(request);
  const value = body?.now;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return fail(400, "Body must be { now: an ISO date-time string }");
  }
  return ok({ now: setClock(value) });
}
