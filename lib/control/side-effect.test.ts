// 4.3 (Trail #25): a side-effect note moves the call's open refill to Review, with the
// note on it, instead of leaving it in Quick check (SPEC inbound step 8).
import { beforeEach, describe, expect, it } from "vitest";
import type { ButtonResult, CallId, QueueItem, StreamEvent, Store } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl, type Control } from "./press";

const CODE = "135790";
const SAM = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };

let store: Store;
let control: Control;
let events: StreamEvent[];

beforeEach(() => {
  store = createMemoryStore(SEED);
  events = [];
  control = createControl({ store, emit: (e) => events.push(e), makeCode: () => CODE });
});

const out = (r: ButtonResult) => {
  if (!r.ok) throw new Error(`press failed: ${r.error}`);
  return r.output as Record<string, unknown>;
};

async function verifiedSam(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = out(await control.press(callId, "lookup_patient", SAM));
  expect(out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE })).verified).toBe(true);
  return callId;
}

const refillFor = (rxId: string) => async () => (await store.queue()).filter((q) => q.kind === "refill" && q.rxId === rxId);
const concertaItems = refillFor(IDS.samConcerta);
const notes = async () => (await store.queue()).filter((q) => q.kind === "note");
const queueEvents = () => events.filter((e): e is Extract<StreamEvent, { type: "queue" }> => e.type === "queue");

function expectInReviewWithNote(item: QueueItem | undefined, text: string) {
  expect(item).toMatchObject({ lane: "review", status: "open" });
  expect(item!.signals).toContain("side_effect");
  expect(item!.notes).toContainEqual(expect.objectContaining({ kind: "side_effect", text }));
}

describe("4.3: a side-effect note moves the call's open refill to Review", () => {
  it("refill then note: the refill moves to Review with the note, with no separate note item", async () => {
    const callId = await verifiedSam();
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, lane: "quick_check" });
    const before = queueEvents().length;
    const note = await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild headaches", kind: "side_effect" });
    expect(note).toMatchObject({ ok: true, lane: "review" });

    const [item] = await concertaItems();
    expectInReviewWithNote(item, "Mild headaches");
    expect(await store.queue("quick_check")).toEqual([]);
    expect(await notes()).toEqual([]);
    const moved = queueEvents().slice(before);
    expect(moved).toHaveLength(1);
    expect(moved[0].item).toMatchObject({ id: item.id, lane: "review" });
    const entry = (await store.listRecord(callId)).filter((e) => e.button === "note_for_pharmacist").at(-1);
    expect(entry).toMatchObject({ decision: "allowed", lane: "review" });
  });

  it("note then refill: the refill lands in Review with the side_effect signal", async () => {
    const callId = await verifiedSam();
    await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Trouble sleeping", kind: "side_effect" });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, lane: "review" });
    const [item] = await concertaItems();
    expect(item).toMatchObject({ lane: "review", status: "open" });
    expect(item.signals).toContain("side_effect");
    expect(await store.queue("quick_check")).toEqual([]);
  });

  it("a side-effect note without rx_id moves the call's open refill", async () => {
    const callId = await verifiedSam();
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    await control.press(callId, "note_for_pharmacist", { text: "Feeling jittery", kind: "side_effect" });
    expectInReviewWithNote((await concertaItems())[0], "Feeling jittery");
    expect(await notes()).toEqual([]);
  });

  it("a side-effect note about another prescription leaves the Concerta refill where it is", async () => {
    const callId = await verifiedSam();
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const [before] = await concertaItems();
    await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samMetformin, text: "Upset stomach", kind: "side_effect" });
    const [after] = await concertaItems();
    expect(after).toMatchObject({ id: before.id, lane: before.lane, signals: before.signals, notes: before.notes });
    expect((await notes()).map((q) => q.rxId)).toEqual([IDS.samMetformin]);
  });

  it("a question note moves nothing", async () => {
    const callId = await verifiedSam();
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const [before] = await concertaItems();
    await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Can I take it with coffee?", kind: "question" });
    const [after] = await concertaItems();
    expect(after).toMatchObject({ id: before.id, lane: before.lane, signals: before.signals, notes: before.notes });
    expect(await notes()).toHaveLength(1);
  });
});
