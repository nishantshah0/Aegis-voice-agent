// Audit fix 4 (a): S4's "approved" needs the pharmacist's approval of a refill or renewal, not of
// a plain note. Before, any approval entry on the call backed "Your Concerta refill is approved."
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

const CODE = "112358";
const PHARMACIST = { id: "u_test", name: "Test Pharmacist", role: "pharmacist" as const };
let store: Store;
let control: Control;
let callId: CallId;

beforeEach(async () => {
  store = createMemoryStore(SEED);
  control = createControl({ store, makeCode: () => CODE });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  callId = started.callId;
  await control.press(callId, "send_code", { lookup_id: started.lookupId });
  await control.press(callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" });
});

const approveAll = async (kind: string) => {
  for (const item of (await store.queue()).filter((q) => q.kind === kind && q.status === "open")) await store.decide(item.id, "approve", PHARMACIST);
};

describe("S4: 'approved' needs an approved refill or renewal", () => {
  it("a note approved by the pharmacist, with no refill order, doesn't back 'your refill is approved'", async () => {
    await control.press(callId, "note_for_pharmacist", { text: "Can I take it with coffee?", kind: "question" });
    await approveAll("note");
    const guard = createSpeechGuard({ store });
    expect(await guard(callId, "Your Concerta refill is approved.")).toMatchObject({ blocked: true, rule: "S4" });
  });

  it("an approved refill does back it", async () => {
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    await approveAll("refill");
    const guard = createSpeechGuard({ store });
    expect((await guard(callId, "Your Concerta refill is approved.")).blocked).toBe(false);
  });
});
