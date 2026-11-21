import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { createFakes } from "@/lib/contract/fakes";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { dosePhrases } from "./doses";
import { classify } from "./safety";
import { wordsToNumber } from "./doses";

describe("S3 reads spelled-out numbers", () => {
  it.each([
    ["seven", 7],
    ["thirty six", 36],
    ["thirty-six", 36],
    ["two hundred and fifty", 250],
    ["two hundred fifty", 250],
    ["nineteen", 19],
  ])("%s → %s", (run, n) => {
    expect(wordsToNumber(run)).toBe(n);
  });

  it("finds doses written in words", () => {
    expect(dosePhrases("Take seven tablets")).toContain("7 tablet");
    expect(dosePhrases("thirty milligrams")).toContain("30mg");
    expect(dosePhrases("thirty six milligrams")).toContain("36mg");
    expect(dosePhrases("three times a day")).toContain("3 times a day");
  });

  it("doesn't turn words into numbers when they aren't number words", () => {
    expect(dosePhrases("Someone will call you")).toEqual([]);
  });
});

describe("emergency phrases the first list missed", () => {
  it.each(["I'm having a bad reaction", "I can't swallow", "my heart is racing", "I took two doses by mistake", "I think I doubled up", "her lips are blue"])(
    "%s → emergency",
    (line) => {
      expect(classify(line).action).toBe("emergency");
    },
  );
});

describe("a denied order is never overwritten", () => {
  it("re-requesting after a denial makes a new order and keeps the denied one", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "111111" });
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    await control.press(callId, "check_code", { lookup_id: (lookup as { output: { lookup_id: string } }).output.lookup_id, code: "111111" });
    const first = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const [item] = await store.queue("quick_check");
    await store.decide(item.id, "deny", { id: "u", name: "P", role: "pharmacist" });
    const again = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const ids = (o: unknown) => (o as { output: { order_id: string } }).output.order_id;
    expect(ids(again)).not.toBe(ids(first));
    const orders = await store.listOrders(IDS.sam);
    expect(orders.map((o) => [o.id, o.state])).toEqual([
      [ids(first), "denied"],
      [ids(again), "waiting_for_pharmacist"],
    ]);
  });
});

describe("fakes compare lockout times as times", () => {
  it("a lockout in UTC still holds against a demo clock with an offset", async () => {
    const { store, press, driver } = createFakes();
    const callId = await driver.startCall({ direction: "outbound", patientId: IDS.sam });
    for (let i = 0; i < 3; i++) await press(callId, "check_code", { lookup_id: "none", code: "000000" });
    // Ten minutes later, still inside the 15-minute lockout.
    await store.setNow("2026-11-24T10:10:00-05:00");
    const r = await press(callId, "check_code", { lookup_id: "none", code: "246810" });
    expect(r.ok && "locked_until" in r.output).toBe(true);
  });
});
