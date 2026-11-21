import { beforeEach, describe, expect, it } from "vitest";
import { GUARD_REPLACEMENTS, type CallId, type GuardSentenceFn, type StreamEvent, type Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { classify, createSafetyCheck } from "./safety";
import { createSpeechGuard, S4_REPLACEMENT } from "./speech";
import { dosePhrases } from "./doses";

const CODE = "246135";
let store: Store;
let control: Control;
let guard: GuardSentenceFn;
let events: StreamEvent[];
let safety: ReturnType<typeof createSafetyCheck>;

beforeEach(() => {
  store = createMemoryStore(SEED);
  events = [];
  const emit = (e: StreamEvent) => events.push(e);
  control = createControl({ store, emit, makeCode: () => CODE });
  guard = createSpeechGuard({ store, emit });
  safety = createSafetyCheck({ store, emit });
});

async function verifiedSam(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup");
  const check = await control.press(callId, "check_code", { lookup_id: (lookup.output as { lookup_id: string }).lookup_id, code: CODE });
  if (!check.ok) throw new Error("check");
  return callId;
}

const blocks = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

describe("S1: before verification, nothing from the records the caller hasn't said", () => {
  it.each([
    ["a name", "Is this about Sam Rivera?"],
    ["a drug", "Your Concerta refill is due."],
    ["a prescription number", "I see prescription 100201."],
    ["a phone number", "We have 555 0101 on file."],
    ["an address", "Is it still 12 Elm Row?"],
    ["a date of birth", "Was that March 14, 1990?"],
    ["another patient's drug", "We also stock Adderall XR."],
  ])("blocks %s", async (_what, sentence) => {
    const callId = await control.startInboundCall();
    expect(await blocks(callId, sentence)).toBe("S1");
  });

  it("passes ordinary lines", async () => {
    const callId = await control.startInboundCall();
    expect(await blocks(callId, "Thanks for calling. Can I have your name, date of birth and prescription number?")).toBeNull();
    expect(await blocks(callId, "One moment.")).toBeNull();
  });

  it("lets the agent repeat what the caller said", async () => {
    const callId = await control.startInboundCall();
    await safety(callId, "Hi, this is Sam Rivera, I need my Concerta.");
    expect(await blocks(callId, "Thanks, Sam Rivera. I can look up your Concerta once you're verified.")).toBeNull();
    expect(await blocks(callId, "Is your number 555-0101?")).toBe("S1");
  });

  it("the outbound opener may say the patient's name, only as the first line", async () => {
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    expect(await blocks(started.callId, "Hi, this is Maple Street Pharmacy calling for Sam.")).toBeNull();
    expect(await blocks(started.callId, "Sam, your Concerta is due.")).toBe("S1");
  });

  it("the opener can't name the drug", async () => {
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    expect(await blocks(started.callId, "Hi Sam, calling about your Concerta.")).toBe("S1");
  });

  it("replaces with the fixed line and logs it", async () => {
    const callId = await control.startInboundCall();
    const r = await guard(callId, "Your Concerta is ready.");
    expect(r).toEqual({ speak: GUARD_REPLACEMENTS.S1, blocked: true, rule: "S1", original: "Your Concerta is ready." });
    expect(events.at(-1)).toMatchObject({ type: "blocked_line", rule: "S1", replacement: GUARD_REPLACEMENTS.S1 });
    expect((await store.listRecord(callId)).at(-1)).toMatchObject({ kind: "line_blocked", decision: "blocked" });
  });
});

describe("S2: after verification, nothing of another patient's", () => {
  it("blocks another patient's name, drug or number", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "Dev Halvorsen also called today.")).toBe("S2");
    expect(await blocks(callId, "Your Adderall XR is on file.")).toBe("S2");
    expect(await blocks(callId, "The number 555-0104 is on that account.")).toBe("S2");
  });

  it("passes the patient's own details", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "Sam, I can see your Concerta and your Metformin.")).toBeNull();
    expect(await blocks(callId, "Delivery to 12 Elm Row works.")).toBeNull();
  });

  it("household members share an address and surname without leaking each other", async () => {
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Grace Tanaka", dob: "1958-01-08", rx_number: "RX-100601" });
    await control.press(callId, "check_code", { lookup_id: (lookup as { output: { lookup_id: string } }).output.lookup_id, code: CODE });
    expect(await blocks(callId, "Grace Tanaka, your Levothyroxine goes to 22 Oak Crescent.")).toBeNull();
    expect(await blocks(callId, "Robin's Rosuvastatin is due too.")).toBe("S2");
  });
});

describe("S3: every dose is on the locked patient's label", () => {
  it("finds doses, frequencies and quantities", () => {
    expect(dosePhrases("Take 20 milligrams twice a day, two tablets every 6 hours")).toEqual(
      expect.arrayContaining(["20mg", "twice a day", "2 tablet", "every 6 hour"]),
    );
  });

  it("passes doses on the label, in other words", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "Your label says 36 mg, one tablet every morning.")).toBeNull();
    expect(await blocks(callId, "The Metformin is 500 milligrams, twice daily.")).toBeNull();
  });

  it("blocks a dose that isn't on the label, and leaves a note for the pharmacist", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "You could take two tablets if you feel tired.")).toBe("S3");
    expect(await blocks(callId, "Try 54 mg instead.")).toBe("S3");
    const notes = await store.queue("review");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ kind: "note", signals: ["speech_guard_replacement"] });
    expect((await guard(callId, "Take it every 6 hours.")).speak).toBe(GUARD_REPLACEMENTS.S3);
  });
});

describe("S4: every promise matches the record", () => {
  it("blocks 'approved' before an approval, passes it after", async () => {
    const callId = await verifiedSam();
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    expect(await blocks(callId, "Your refill is approved.")).toBe("S4");
    expect((await guard(callId, "It's ready.")).speak).toBe(S4_REPLACEMENT);
    const [item] = await store.queue("quick_check");
    await store.decide(item.id, "approve", { id: "u1", name: "Test Pharmacist", role: "pharmacist" });
    expect(await blocks(callId, "Your refill is approved.")).toBeNull();
  });

  it("passes conditional wording", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "Once a pharmacist approves it, it'll be ready.")).toBeNull();
    expect(await blocks(callId, "It isn't approved yet.")).toBeNull();
  });

  it("a day only if it's the booked slot", async () => {
    const callId = await verifiedSam();
    const refill = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const orderId = (refill as { output: { order_id: string } }).output.order_id;
    expect(await blocks(callId, "We'll bring it Thursday.")).toBe("S4");
    await control.press(callId, "set_delivery", { order_id: orderId, slot_id: "slot_thu_am", address_id: "addr_sam_home" });
    expect(await blocks(callId, "We'll bring it Thursday morning.")).toBeNull();
    expect(await blocks(callId, "We'll bring it Friday.")).toBe("S4");
  });

  it("a price only if it's the coverage figure", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "You'll pay $4.10.")).toBe("S4");
    await control.press(callId, "check_coverage", { rx_id: IDS.samConcerta });
    expect(await blocks(callId, "You'll pay $4.10.")).toBeNull();
    expect(await blocks(callId, "You'll pay $3.00.")).toBe("S4");
  });

  it("'sent' or 'requested' only after that button succeeded", async () => {
    const callId = await verifiedSam();
    expect(await blocks(callId, "I've requested a renewal.")).toBe("S4");
    await control.press(callId, "request_renewal", { rx_id: IDS.samMetformin });
    expect(await blocks(callId, "I've requested a renewal.")).toBeNull();
  });
});

describe("guard bookkeeping", () => {
  it("records every spoken and blocked line, and the chain stays intact", async () => {
    const callId = await control.startInboundCall();
    await guard(callId, "Hello.");
    await guard(callId, "Your Concerta is due.");
    const kinds = (await store.listRecord(callId)).map((e) => e.kind).filter((k) => k.startsWith("line"));
    expect(kinds).toEqual(["line_spoken", "line_blocked"]);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("a blocked line sends the next refill to Review", async () => {
    const callId = await verifiedSam();
    await guard(callId, "Dev Halvorsen called too.");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ lane: "review" });
  });

  it("an unknown call speaks nothing from the records", async () => {
    expect((await guard("c_nope", "Hello Sam.")).blocked).toBe(true);
  });
});

describe("safety keywords", () => {
  it.each([
    ["I can't breathe after taking it", "emergency"],
    ["My throat is closing up", "emergency"],
    ["I think I took too many pills", "emergency"],
    ["I have chest pain", "emergency"],
    ["I want to kill myself", "crisis"],
    ["Honestly I don't want to live anymore", "crisis"],
    ["Can I talk to a real person?", "handover"],
    ["Let me speak to the pharmacist", "handover"],
  ])("%s → %s", (line, action) => {
    expect(classify(line).action).toBe(action);
  });

  it.each(["I need a refill of my Concerta", "My date of birth is March 14, 1990", "Thursday works for delivery"])("passes '%s'", (line) => {
    expect(classify(line)).toEqual({ action: "continue" });
  });

  it("a crisis puts the patient's refills on hold for a pharmacist and flags the call", async () => {
    const callId = await verifiedSam();
    const r = await safety(callId, "I want to end my life");
    expect(r.action).toBe("crisis");
    expect(r.action !== "continue" && r.script).toContain("9-8-8");
    const [item] = await store.queue("review");
    expect(item).toMatchObject({ patientId: IDS.sam, kind: "escalation", signals: ["safety_words"] });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ lane: "review" });
  });

  it("records every caller line, so S1 knows what the caller said", async () => {
    const callId = await control.startInboundCall();
    await safety(callId, "Hello");
    expect((await store.listRecord(callId)).at(-1)).toMatchObject({ kind: "caller_line", actor: "caller" });
    expect((await store.getCall(callId))?.callerSaid).toEqual(["Hello"]);
  });
});
