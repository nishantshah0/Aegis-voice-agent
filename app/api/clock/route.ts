import { connection } from "next/server";
import type { ClockResponse } from "@/lib/contract";
import { emit } from "@/lib/events";
import { fail, ok, readObject } from "../_lib/http";
import { getStore } from "../_lib/runtime";

// The demo clock lives on the Store, so the rules and reset share one clock.
// GET /api/clock → { now }. POST /api/clock { now } sets it and sends a "clock"
// event. The time is kept exactly as given, offset included (e.g. -05:00), so the
// control layer can work out the pharmacy's local hour.
// TODO(2.4, finding F3): require a signed-in role or a demo flag to set it.

export async function GET() {
  await connection();
  const body: ClockResponse = { now: await getStore().now() };
  return ok(body);
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export async function POST(request: Request) {
  const body = await readObject(request);
  const value = typeof body?.now === "string" ? body.now.trim() : "";
  if (!ISO_WITH_ZONE.test(value) || Number.isNaN(Date.parse(value))) {
    return fail(400, "Body must be { now: an ISO date-time with Z or an offset, like 2026-11-24T10:00:00-05:00 }");
  }
  await getStore().setNow(value);
  emit({ type: "clock", now: value });
  const res: ClockResponse = { now: value };
  return ok(res);
}
