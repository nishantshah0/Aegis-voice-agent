// Role 1's REQUEST (1.3, demo step 2): request_refill and order_status say when the refill will be
// ready, so the agent can say "ready Thursday once it's approved" from the record, not invent it.
// Sam calls on the demo Tuesday; a refill is ready two days later (Sundays skipped): Thursday.
import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl, readyDay } from "./press";

async function verifiedSam() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "112358" });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "112358", dob: "1990-03-14" });
  return { store, control, callId: started.callId };
}

describe("ready_label", () => {
  it("request_refill returns the ready day with a refill waiting for a pharmacist", async () => {
    const { control, callId } = await verifiedSam();
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({
      ok: true,
      output: { state: "waiting_for_pharmacist", ready_label: "Thursday" },
    });
  });

  it("order_status lists the same ready day for the open order", async () => {
    const { control, callId } = await verifiedSam();
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const status = await control.press(callId, "order_status", {});
    expect(status).toMatchObject({ ok: true, output: { orders: [expect.objectContaining({ rx_id: IDS.samConcerta, ready_label: "Thursday" })] } });
  });

  it("is two days after the request in pharmacy time, skipping Sunday", () => {
    expect(readyDay("2026-11-24T10:00:00-05:00")).toBe("Thursday"); // Tuesday
    expect(readyDay("2026-11-27T10:00:00-05:00")).toBe("Monday"); // Friday: Saturday, then Monday
    expect(readyDay("2026-11-28T10:00:00-05:00")).toBe("Tuesday"); // Saturday: Monday, Tuesday
  });
});
