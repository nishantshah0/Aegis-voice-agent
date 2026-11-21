import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard, isCompletionPromise } from "./speech";

// Code review on main, finding 1 (high): S4 must block a completion word with no approval in the
// record even when the sentence names no order or drug. Only the explicit non-promises are exempt.
const BARE = ["The pharmacist approved.", "Good news, you're approved.", "Done, all approved.", "Approved!"];

async function verifiedSam() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "111111" });
  const guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("refused");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "111111", dob: "1990-03-14" });
  return { store, guard, callId: started.callId };
}

describe("S4: a completion word with no subject is still a promise", () => {
  it.each(BARE)("promise: %s", (s) => {
    expect(isCompletionPromise(s, [])).toBe(true);
  });

  it.each(BARE)("blocked before an approval, allowed after one: %s", async (s) => {
    const { store, guard, callId } = await verifiedSam();
    const before = await guard(callId, s);
    expect(before.blocked).toBe(true);
    expect(before.rule).toBe("S4");
    await store.appendRecord({ callId, actor: "pharmacist", kind: "approval", output: { status: "approved" }, decision: "allowed" });
    expect((await guard(callId, s)).blocked).toBe(false);
  });
});
