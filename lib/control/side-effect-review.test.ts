import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl } from "./press";

// SPEC inbound step 8 (Trail #25): a side-effect note moves this call's open refill to Review,
// with the note and the side_effect signal on it. Anything else leaves the refill where it is.
const CODE = "111111";
const sam = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };

async function verifiedSam() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", sam);
  const lookupId = (lookup as { output: { lookup_id: string } }).output.lookup_id;
  await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE });
  const refill = () => control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  const note = (input: { rx_id?: string; text: string; kind: "side_effect" | "question" }) => control.press(callId, "note_for_pharmacist", input);
  return { store, refill, note };
}

const refills = async (store: ReturnType<typeof createMemoryStore>) => (await store.queue()).filter((q) => q.kind === "refill");

describe("a side-effect note sends the call's open refill to Review", () => {
  it("refill, then a side-effect note on it: the refill moves to Review with the note", async () => {
    const { store, refill, note } = await verifiedSam();
    expect(await refill()).toMatchObject({ ok: true, lane: "quick_check" });
    expect(await note({ rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" })).toMatchObject({ ok: true, lane: "review" });
    expect(await store.queue("quick_check")).toEqual([]);
    const [item] = await refills(store);
    expect(item.lane).toBe("review");
    expect(item.signals).toContain("side_effect");
    expect(item.notes.map((n) => n.text)).toContain("Mild afternoon headaches");
    expect(await store.queue()).toHaveLength(1);
  });

  it("a side-effect note, then the refill: the refill lands in Review", async () => {
    const { store, refill, note } = await verifiedSam();
    await note({ rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" });
    await refill();
    const [item] = await refills(store);
    expect(item.lane).toBe("review");
    expect(item.signals).toContain("side_effect");
    expect(await store.queue("quick_check")).toEqual([]);
  });

  it("a side-effect note with no rx_id moves the call's open refill", async () => {
    const { store, refill, note } = await verifiedSam();
    await refill();
    await note({ text: "Mild afternoon headaches", kind: "side_effect" });
    const [item] = await refills(store);
    expect(item.lane).toBe("review");
    expect(item.signals).toContain("side_effect");
  });

  it("a side-effect note on another prescription leaves the refill in Quick check", async () => {
    const { store, refill, note } = await verifiedSam();
    await refill();
    await note({ rx_id: IDS.samMetformin, text: "Upset stomach", kind: "side_effect" });
    const [item] = await refills(store);
    expect(item.lane).toBe("quick_check");
    expect(item.signals).not.toContain("side_effect");
    const notes = (await store.queue("review")).filter((q) => q.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0].signals).toContain("side_effect");
  });

  it("a question note leaves the refill in Quick check", async () => {
    const { store, refill, note } = await verifiedSam();
    await refill();
    await note({ rx_id: IDS.samConcerta, text: "Can I take it with coffee?", kind: "question" });
    const [item] = await refills(store);
    expect(item.lane).toBe("quick_check");
    expect(item.signals).not.toContain("side_effect");
    const notes = (await store.queue("review")).filter((q) => q.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0].signals).toEqual([]);
  });
});
