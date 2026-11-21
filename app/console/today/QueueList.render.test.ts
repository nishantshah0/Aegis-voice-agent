import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StreamEvent } from "@/lib/contract";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { itemDetail, laneTotals } from "./detail";
import { QueueList } from "./QueueList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

// What the pharmacist's Today page shows after Sam's call on the real lock.
describe("Today page markup", () => {
  it("shows Sam's refill with the rule, his side effect, the blocked promise and the labelled AI view", async () => {
    const store = getStore();
    const control = getControl();
    const guard = createSpeechGuard({ store, emit });
    const safety = createSafetyCheck({ store, emit });
    const events: StreamEvent[] = [];
    subscribe((d) => events.push(d.event));
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused Sam");
    const { callId, lookupId } = started;
    await control.press(callId, "send_code", { lookup_id: lookupId });
    const code = events.flatMap((e) => (e.type === "phone" && e.kind === "code" ? [e.text.match(/\d{6}/)![0]] : [])).pop()!;
    await control.press(callId, "check_code", { lookup_id: lookupId, code });
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta, reason: "Routine refill" });
    await guard(callId, "Your Concerta refill is approved.");
    await safety(callId, "I've been sleeping badly.");
    await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Sleeping badly", kind: "side_effect" });

    const open = (await store.queue()).filter((q) => q.status === "open" && q.lane !== "automatic");
    const waiting = await Promise.all(open.map((q) => itemDetail(store, q)));
    const html = renderToStaticMarkup(
      createElement(QueueList, { totals: await laneTotals(store), waiting, decided: [], canDecide: true, signedIn: true }),
    );

    expect(html).toContain("Concerta 36 mg");
    expect(html).toContain("for S.R.");
    expect(html).toContain("Rule 4");
    expect(html).toContain("“Sleeping badly”");
    expect(html).toMatch(/line-through">Your Concerta refill is approved\.<\/span>/);
    expect(html).toContain("blocked by S4");
    expect(html).toContain("Self-reported by the AI. Shown for context, never used for decisions.");
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Deny</button>");
  });
});

describe("Quick check lane", () => {
  it("lists Quick check items as compact rows with one-tap Approve and Deny, after Review", async () => {
    const store = getStore();
    for (let i = 1; i <= 6; i++) {
      await store.addQueueItem({ callId: `c_qc_${i}`, patientId: IDS.sam, rxId: IDS.samConcerta, kind: "refill", lane: "quick_check", ruleIds: ["4"], signals: [], notes: [] });
    }
    await store.addQueueItem({ callId: "c_rv", patientId: IDS.sam, kind: "note", lane: "review", ruleIds: [], signals: ["side_effect"], notes: [] });
    const open = (await store.queue()).filter((q) => q.status === "open");
    const details = await Promise.all(open.map((q) => itemDetail(store, q)));
    const html = renderToStaticMarkup(
      createElement(QueueList, { totals: await laneTotals(store), waiting: details, decided: [], canDecide: true, signedIn: true }),
    );
    const quick = html.slice(html.indexOf('data-testid="quick-check"'));
    expect(html.indexOf('data-testid="review"')).toBeLessThan(html.indexOf('data-testid="quick-check"'));
    expect(quick.match(/>Approve<\/button>/g)).toHaveLength(6);
    expect(quick).not.toContain("<details open");
  });
});
