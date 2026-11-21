import { randomBytes } from "node:crypto";

// Paired patient phones (Trail #19). Signed-in staff pair "this screen is Sam's phone":
// a one-time link, valid 10 minutes, that sets an httpOnly device cookie bound to that
// patient. Only that device can answer the patient's outbound calls or hear their ring.

const PAIR_MS = 10 * 60 * 1000;
export const DEVICE_COOKIE = "rg_device";

type State = {
  pairings: Map<string, { patientId: string; expires: number }>;
  devices: Map<string, string>; // device token → patient id
  rings: Map<string, string>; // call id → patient id it rang
};
const holder = globalThis as typeof globalThis & { __refillGuardDevices?: State };
const state = (): State => (holder.__refillGuardDevices ??= { pairings: new Map(), devices: new Map(), rings: new Map() });

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

export function createPairing(patientId: string): { code: string; expiresAt: string } {
  const code = token(18);
  const expires = Date.now() + PAIR_MS;
  state().pairings.set(code, { patientId, expires });
  return { code, expiresAt: new Date(expires).toISOString() };
}

/** Use a pairing code once. Returns the new device token, or null if unknown, used or expired. */
export function claimPairing(code: string): string | null {
  const pairing = state().pairings.get(code);
  state().pairings.delete(code);
  if (!pairing || pairing.expires < Date.now()) return null;
  const device = token(24);
  state().devices.set(device, pairing.patientId);
  return device;
}

/** The patient whose paired device sent this request, or null. */
export function devicePatient(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${DEVICE_COOKIE}=`));
  return match ? (state().devices.get(match.slice(DEVICE_COOKIE.length + 1)) ?? null) : null;
}

export function recordRing(callId: string, patientId: string): void {
  state().rings.set(callId, patientId);
}

export function ringTarget(callId: string): string | undefined {
  return state().rings.get(callId);
}

/** Test helper. */
export function clearDevicesForTests(): void {
  holder.__refillGuardDevices = undefined;
}
