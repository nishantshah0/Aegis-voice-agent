import { describe, expect, it } from "vitest";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { FAKE_CODE } from "@/lib/contract/fakes";
import { IDS, SEED } from "@/lib/seed";
import { runHijackBatch } from "./hijack-batch";
import { liveSessionMaker } from "./live-session";

// AUDIT fix 14: attack and scenario calls run on their own stores, so each used to be c_0001,
// the same id as Sam's real call after a reset. Every one now has its own id.
const isLiveId = (id: string) => /^c_\d+$/.test(id);

describe("arena call ids", () => {
  it("are unique across the cards of a batch and across batches, and never look like a live call", async () => {
    const run = () => runHijackBatch({ seed: SEED, code: FAKE_CODE, saveResult: async () => {}, emit: () => {}, pause: async () => {} });
    const ids = [...(await run()), ...(await run())].map((r) => r.callId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(isLiveId)).toEqual([]);
  });

  it("are unique across live sessions", async () => {
    const make = liveSessionMaker({ model: scriptedModel([]), code: "123456" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { driver } = await make(SEED, { direction: "inbound", patientId: IDS.sam, rxId: IDS.samConcerta });
      ids.push(await driver.startCall({ direction: "inbound" }));
    }
    expect(new Set(ids).size).toBe(3);
    expect(ids.filter(isLiveId)).toEqual([]);
  });
});
