// 4.7: the core demo's lock path, end to end on main's real parts (store, control,
// guard, safety check), run twice from a reset. It plays the presses and lines a
// driver would send for Sam's outbound call; the AI itself is Role 1's part.

import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";

const CODE = "112358";
const pharmacist = { id: "u_demo", name: "Demo Pharmacist", role: "pharmacist" as const };

async function samsCall() {
  const store = createMemoryStore(SEED);
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);
  const control = createControl({ store, emit, makeCode: () => CODE });
  const guard = createSpeechGuard({ store, emit });
  const safety = createSafetyCheck({ store, emit });
  const spoken: string[] = [];
  const say = async (callId: string, sentence: string) => {
    const r = await guard(callId, sentence);
    spoken.push(r.speak);
    return r;
  };

  // The daily check rings Sam (rule 7 allows it at Tuesday 10 AM).
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error(`outbound refused: ${started.ruleIds}`);
  const { callId, lookupId } = started;

  // Note: any speech-guard replacement in the call sends the refill to Review (SPEC triage),
  // so the demo agent must not trip S1 here, or Sam's refill skips Quick check.
  expect((await say(callId, "Hi, this is Maple Street Pharmacy calling for Sam.")).blocked).toBe(false);
  await control.press(callId, "send_code", { lookup_id: lookupId });
  expect(events.some((e) => e.type === "phone" && e.kind === "code")).toBe(true);
  expect(await control.codeFor(callId)).toBe(CODE);

  expect((await safety(callId, `Sure, the code is ${CODE}.`)).action).toBe("continue");
  const verified = await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE });
  expect(verified).toMatchObject({ ok: true, output: { verified: true, patient_first_name: "Sam" } });

  // The refill: rule 4 sends a controlled drug to Quick check; 3 and 4b pass at 27 days.
  const refill = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  expect(refill).toMatchObject({ ok: true, lane: "quick_check", ruleIds: ["4"], output: { state: "waiting_for_pharmacist" } });
  expect(await say(callId, "Your Concerta refill is approved.")).toMatchObject({ blocked: true, rule: "S4" });
  expect((await say(callId, "Once a pharmacist approves it, I'll let you know.")).blocked).toBe(false);

  // The side-effect question: a mild answer moves Sam's refill to Review with the note on it
  // (SPEC inbound step 8), so Quick check is empty and a pharmacist reads the note first.
  expect((await safety(callId, "I've had some mild headaches in the afternoon.")).action).toBe("continue");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" });
  expect(await store.queue("quick_check")).toEqual([]);
  const review = await store.queue("review");
  expect(review).toHaveLength(1);
  const [item] = review;
  expect(item).toMatchObject({ kind: "refill", rxId: IDS.samConcerta, status: "open", lane: "review" });
  expect(item.signals).toContain("side_effect");
  expect(item.notes).toContainEqual(expect.objectContaining({ kind: "side_effect", text: "Mild afternoon headaches" }));
  expect(await say(callId, "Your Concerta refill is approved.")).toMatchObject({ blocked: true, rule: "S4" });

  // The pharmacist approves it from Review; now "approved" is true and may be said.
  await store.decide(item.id, "approve", pharmacist);
  expect((await say(callId, "Your Concerta refill is approved.")).blocked).toBe(false);
  await control.endCall(callId);

  const record = await store.listRecord();
  expect(findBrokenLink(record)).toBeNull();
  return { record, spoken, events };
}

describe("4.7: Sam's demo call on the real lock", () => {
  it("works twice in a row from a reset, with the same record both times", async () => {
    const first = await samsCall();
    const second = await samsCall();
    expect(second.spoken).toEqual(first.spoken);
    expect(second.record.map((e) => e.hash)).toEqual(first.record.map((e) => e.hash));
    expect(first.events.filter((e) => e.type === "press").map((e) => (e as { decision: string }).decision)).toEqual([
      "allowed",
      "allowed",
      "routed",
      "allowed",
    ]);
  });
});
