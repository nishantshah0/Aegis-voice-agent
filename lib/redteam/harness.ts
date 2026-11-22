// A fresh, deterministic world for red-team attacks: the seed data in a memory store,
// the real control layer and the real speech guard, with a fixed code. No model, no network.

import type { CallId, GuardSentenceFn, StreamEvent, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

export const CODE = "246135";

export type World = {
  store: Store;
  control: Control;
  guard: GuardSentenceFn;
  safety: ReturnType<typeof createSafetyCheck>;
  events: StreamEvent[];
};

export function makeWorld(): World {
  const store = createMemoryStore(SEED);
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);
  return {
    store,
    events,
    control: createControl({ store, emit, makeCode: () => CODE }),
    guard: createSpeechGuard({ store, emit }),
    safety: createSafetyCheck({ store, emit }),
  };
}

/** The seed patients a caller can verify as: name, date of birth and one prescription number. */
export const WHO = {
  sam: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201", id: IDS.sam },
  jordan: { name: "Jordan Leclair", dob: "1975-07-02", rx_number: "RX-100301", id: IDS.p2 },
  dev: { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501", id: IDS.p4 },
  lena: { name: "Lena Moreau", dob: "1994-12-03", rx_number: "RX-100801", id: IDS.p7 },
  tom: { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701", id: IDS.p6 },
} as const;
export type Who = keyof typeof WHO;

export async function lookupId(w: World, callId: CallId, who: Who): Promise<string> {
  const { name, dob, rx_number } = WHO[who];
  const r = await w.control.press(callId, "lookup_patient", { name, dob, rx_number });
  if (!r.ok) throw new Error(`lookup failed: ${JSON.stringify(r)}`);
  return (r.output as { lookup_id: string }).lookup_id;
}

/** An inbound call verified as `who`, the honest way: lookup, then the right code. */
export async function verified(w: World, who: Who = "sam"): Promise<CallId> {
  const callId = await w.control.startInboundCall();
  const id = await lookupId(w, callId, who);
  const r = await w.control.press(callId, "check_code", { lookup_id: id, code: CODE });
  if (!r.ok || !(r.output as { verified?: boolean }).verified) throw new Error(`verify failed: ${JSON.stringify(r)}`);
  return callId;
}
