// 1.4: Sam's typed call as the phone shows it, from the real event stream of the
// real lock and the real driver (scripted model, no key).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StreamEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "@/lib/agent/driver";
import { SIDE_EFFECT_PASSED_ON, outboundOpener } from "@/lib/agent/lines";
import { collect, scriptedModel } from "@/lib/agent/testing/scripted-model";
import { Transcript } from "./Phone";
import { initialPhone, phoneReducer, type PhoneState } from "./state";

const CODE = "112358";

async function samsCallEvents(): Promise<StreamEvent[]> {
  const store = createMemoryStore(SEED);
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);
  const control = createControl({ store, emit, makeCode: () => CODE });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  emit({ type: "phone", callId, kind: "ring", text: "Maple Street Pharmacy is calling" });
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model: scriptedModel([
      { tools: [{ name: "check_code", input: { lookup_id: lookupId, code: CODE } }] },
      { text: ["Thanks, Sam. ", "Want me to send your Concerta refill to the pharmacist now?"] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["Your refill is approved."] },
      { tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samConcerta, text: "Mild headaches", kind: "side_effect" } }] },
      { text: [SIDE_EFFECT_PASSED_ON] },
    ]),
    pharmacyName: "Maple Street Pharmacy",
    emit,
  });
  driver.joinCall(callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
  await collect(driver.opening(callId));
  for (const said of [`It's ${CODE}.`, "Yes please.", "Some mild headaches."]) await collect(driver.callerSays(callId, said));
  // What Role 2's Approve emits for the phone.
  emit({ type: "phone", callId, kind: "status", text: "Approved, ready Thursday" });
  return events;
}

function phoneAfter(events: StreamEvent[]): PhoneState {
  let state = initialPhone();
  for (const event of events) {
    state = phoneReducer(state, { type: "event", event });
    if (state.mode === "ringing") state = phoneReducer(state, { type: "connected", callId: state.callId! });
  }
  return state;
}

describe("1.4: Sam's call on the phone", () => {
  it("rings, shows the code, the whole conversation and the approved status", async () => {
    const phone = phoneAfter(await samsCallEvents());
    expect(phone.mode).toBe("in_call");
    expect(phone.code).toBe(CODE);
    expect(phone.status).toBe("Approved, ready Thursday");
    const said = phone.transcript.flatMap((t) => (t.kind === "line" ? [`${t.who}: ${t.text}`] : []));
    expect(said[0]).toBe(`agent: ${outboundOpener("Maple Street Pharmacy", "Sam Rivera")}`);
    expect(said).toContain(`caller: It's ${CODE}.`);
    expect(said).toContain(`agent: ${SIDE_EFFECT_PASSED_ON}`);
    expect(phone.transcript).toContainEqual(expect.objectContaining({ kind: "blocked", rule: "S4", original: "Your refill is approved." }));
  });

  it("renders a blocked line struck through and labelled, and the lines that were said", async () => {
    const phone = phoneAfter(await samsCallEvents());
    const html = renderToStaticMarkup(createElement(Transcript, { items: phone.transcript }));
    expect(html).toContain('<span class="line-through">Your refill is approved.</span>');
    expect(html).toContain("Stopped by S4 · promise not in the record");
    expect(html).toContain(SIDE_EFFECT_PASSED_ON.replace("'", "&#x27;"));
  });
});
