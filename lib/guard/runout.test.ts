import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard, runOutDay } from "./speech";

describe("S4 and run-out days", () => {
  it("Sam's Concerta runs out on Friday", () => {
    const rx = SEED.prescriptions.find((r) => r.id === IDS.samConcerta)!;
    expect(runOutDay(rx.lastFill, rx.daysSupplied)).toBe("friday");
  });

  it("passes SPEC's 'Your Concerta runs out Friday.' after verification, but not a delivery promise for Friday", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "111111" });
    const guard = createSpeechGuard({ store });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "111111" });
    expect((await guard(started.callId, "Your Concerta runs out Friday.")).blocked).toBe(false);
    expect((await guard(started.callId, "We'll bring it Friday.")).blocked).toBe(true);
    expect((await guard(started.callId, "Your Concerta runs out Monday.")).blocked).toBe(true);
  });
});
