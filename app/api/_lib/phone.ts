import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentDriver, AgentEvent, CallId, Store } from "@/lib/contract";
import { getApprover } from "@/lib/auth/session";
import { demoControlsRefused } from "./demo";
import { fail } from "./http";

// The per-call phone token. The demo phone has no sign-in, so each call gets one
// unguessable token, issued exactly once: by /api/call/start for an inbound call, or by
// the first /api/call/:id/answer for an outbound one. The phone sends it as the
// x-phone-token header to speak, read its code and end the call. Staff (or a demo
// laptop with DEMO_CONTROLS=on) can act on any call.

const holder = globalThis as typeof globalThis & { __refillGuardPhoneTokens?: Map<CallId, string> };
const tokens = () => (holder.__refillGuardPhoneTokens ??= new Map());

/** A new token for this call, or null if one was already handed out. */
export function issuePhoneToken(callId: CallId): string | null {
  if (tokens().has(callId)) return null;
  const token = randomBytes(24).toString("base64url");
  tokens().set(callId, token);
  return token;
}

/** Forget every token (demo reset reuses call ids). */
export function clearPhoneTokens(): void {
  tokens().clear();
}

export function tokenMatches(callId: CallId, given: string | null): boolean {
  const expected = tokens().get(callId);
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** null if this request may act for the call's phone, otherwise the 401 to return. */
export async function phoneRefused(request: Request, callId: CallId): Promise<Response | null> {
  if (tokenMatches(callId, request.headers.get("x-phone-token"))) return null;
  return (await demoControlsRefused()) ? fail(401, "This call's phone token is required") : null;
}

/** Role 1's driver adds these to AgentDriver; the contract's fake doesn't have them. */
export type JoinableDriver = AgentDriver & {
  joinCall?(callId: CallId, opts: { direction: "outbound"; patientId: string; rxId: string; patientName: string }): void;
  opening?(callId: CallId): AsyncIterable<AgentEvent>;
  checkIn?(callId: CallId): AsyncIterable<AgentEvent>;
};

/** Hand an answered call to the driver and collect its opening. */
export async function answerCall(driver: JoinableDriver, store: Store, callId: CallId): Promise<AgentEvent[]> {
  const call = await store.getCall(callId);
  if (call?.direction === "outbound" && call.targetPatientId && driver.joinCall) {
    const start = (await store.listRecord(callId)).find((e) => (e.input as { check?: string })?.check === "call_start");
    const rxId = (start?.input as { rx_id?: string } | undefined)?.rx_id;
    const patient = await store.getPatient(call.targetPatientId);
    if (rxId && patient) {
      driver.joinCall(callId, { direction: "outbound", patientId: patient.id, rxId, patientName: `${patient.firstName} ${patient.lastName}` });
    }
  }
  const events: AgentEvent[] = [];
  if (driver.opening) for await (const event of driver.opening(callId)) events.push(event);
  return events;
}

/** For the code route: only the call's own phone token. Staff never need a patient's code. */
export async function codeRefused(request: Request, callId: CallId): Promise<Response | null> {
  const given = request.headers.get("x-phone-token");
  if (tokenMatches(callId, given)) return null;
  if (given) return fail(403, "That token isn't for this call");
  if (await getApprover()) return fail(403, "Staff can't read a patient's code");
  return fail(401, "This call's phone token is required");
}

/** "Are you still there?": the driver's check-in events, or null if it has no check-in. */
export async function checkInCall(driver: JoinableDriver, callId: CallId): Promise<AgentEvent[] | null> {
  if (!driver.checkIn) return null;
  const events: AgentEvent[] = [];
  for await (const event of driver.checkIn(callId)) events.push(event);
  return events;
}
