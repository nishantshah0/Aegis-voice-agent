// Test helper (Trail #85): an inbound call verified for one seed patient, through the real lock.
import type { CallId, Seed, Store } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl, type Control } from "../press";

export const TEST_CODE = "112358";

export const CALLERS = {
  sam: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" },
  jordan: { name: "Jordan Leclair", dob: "1975-07-02", rx_number: "RX-100301" },
  dev: { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501" },
  lena: { name: "Lena Moreau", dob: "1994-12-03", rx_number: "RX-100801" },
  maria: { name: "Maria Okonkwo", dob: "1962-11-30", rx_number: "RX-100401" },
  grace: { name: "Grace Tanaka", dob: "1958-01-08", rx_number: "RX-100601" },
  tom: { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" },
} as const;

export async function verifiedCall(control: Control, who: keyof typeof CALLERS): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", CALLERS[who]);
  if (!lookup.ok) throw new Error("lookup failed");
  const check = await control.press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code: TEST_CODE });
  if (!check.ok || !("verified" in check.output) || !check.output.verified) throw new Error(`${who} not verified`);
  return callId;
}

export function freshLock(seed: Seed = SEED): { store: Store; control: Control } {
  const store = createMemoryStore(seed);
  return { store, control: createControl({ store, makeCode: () => TEST_CODE }) };
}
