import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl } from "./press";

// AUDIT fix 14: every call gets its own id. The live pharmacy keeps c_0001, c_0002…; a
// control on a throwaway store (an attack or scenario run) can name its calls apart.
describe("call ids", () => {
  it("are c_0001, c_0002… by default, as before", async () => {
    const control = createControl({ store: createMemoryStore(SEED) });
    expect(await control.startInboundCall()).toBe("c_0001");
    const out = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    expect(out.ok && out.callId).toBe("c_0002");
  });

  it("take a prefix, for calls run on their own store", async () => {
    const control = createControl({ store: createMemoryStore(SEED), callIdPrefix: "hijack_abc_early_refill_" });
    expect(await control.startInboundCall()).toBe("hijack_abc_early_refill_0001");
    const out = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    expect(out.ok && out.callId).toBe("hijack_abc_early_refill_0002");
  });
});
