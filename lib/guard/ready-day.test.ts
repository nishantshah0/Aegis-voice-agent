// S4 and ready_label: the ready day from request_refill backs "ready <day>" only, never a delivery
// day (that needs set_delivery), and "ready" itself still needs a condition or an approval.
import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

async function samsCall(requestRefill: boolean) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "112358" });
  const guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "112358", dob: "1990-03-14" });
  if (requestRefill) await control.press(started.callId, "request_refill", { rx_id: IDS.samConcerta });
  return { store, guard, callId: started.callId };
}

describe("S4 backs the ready day from the record", () => {
  it.each(["It'll be ready Thursday once it's approved.", "A pharmacist will check it first, ready Thursday once it's approved."])(
    "allows after request_refill: %s",
    async (s) => {
      const { guard, callId } = await samsCall(true);
      expect((await guard(callId, s)).blocked).toBe(false);
    },
  );

  it.each([
    ["It'll be ready Friday once it's approved.", true],
    ["We'll deliver it Thursday once it's approved.", true],
    ["It's ready Thursday.", true],
    ["It'll be ready Thursday once it's approved.", false],
  ] as const)("blocks: %s (refill requested: %s)", async (s, requested) => {
    const { guard, callId } = await samsCall(requested);
    expect(await guard(callId, s)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it("after the pharmacist approves, 'Approved, ready Thursday.' passes", async () => {
    const { store, guard, callId } = await samsCall(true);
    const [item] = (await store.queue()).filter((q) => q.kind === "refill" && q.status === "open");
    await store.decide(item.id, "approve", { id: "u_test", name: "Test Pharmacist", role: "pharmacist" });
    expect((await guard(callId, "Approved, ready Thursday.")).blocked).toBe(false);
  });
});
