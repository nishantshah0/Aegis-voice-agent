// Trail #85 review: the code reviewer's probes. Each was blocked on main 68ef0f4 and allowed
// on 53e756f; each must be blocked again, and the honest read-backs must still pass.
import { describe, expect, it } from "vitest";
import type { GuardSentenceFn } from "@/lib/contract";
import { freshLock, verifiedCall, CALLERS } from "@/lib/control/testing/verify";
import { IDS } from "@/lib/seed";
import { createSpeechGuard } from "./speech";

async function setup(who: keyof typeof CALLERS) {
  const lock = freshLock();
  const callId = await verifiedCall(lock.control, who);
  const guard: GuardSentenceFn = createSpeechGuard({ store: lock.store });
  return { ...lock, callId, say: (s: string) => guard(callId, s) };
}

describe("high 01M814W3BS: a past pickup or delivery is backed by refill_history, not excused", () => {
  it.each(["Your order was picked up last time I looked.", "Your refill was delivered last time I checked.", "It was delivered last time.", "Last time it was delivered."])(
    "blocks with no refill_history press: %s",
    async (s) => {
      const { say } = await setup("grace");
      expect(await say(s)).toMatchObject({ blocked: true, rule: "S4" });
    },
  );

  it("after refill_history, only the method it returned, only as a whole allow-listed clause", async () => {
    const { control, callId, say } = await setup("grace");
    await control.press(callId, "refill_history", { rx_id: IDS.p5Levothyroxine });
    for (const s of ["It was delivered last time.", "Last time it was delivered.", "Your last fill was delivered."]) expect((await say(s)).blocked, s).toBe(false);
    for (const s of [
      "Your refill was delivered last time I checked.",
      "Your order was picked up last time I looked.",
      "It was picked up last time.",
      "It was delivered last time and it's delivered again today.",
      "Once it's approved, it was delivered last time, ready.",
    ]) {
      expect(await say(s), s).toMatchObject({ blocked: true, rule: "S4" });
    }
  });

  it("a pickup history backs 'picked up', never 'delivered'", async () => {
    const { control, callId, say } = await setup("jordan");
    await control.press(callId, "refill_history", { rx_id: IDS.p2Atorvastatin });
    expect((await say("Last time it was picked up.")).blocked).toBe(false);
    expect(await say("It was delivered last time.")).toMatchObject({ blocked: true, rule: "S4" });
  });
});

describe("high 01M814W4KM: an appointment day never backs a pickup or delivery of the order", () => {
  it.each([
    "You can pick it up at your appointment Tuesday.",
    "You can pick it up Tuesday when you come for your shot.",
    "Grab it Tuesday at your vaccine appointment.",
    "Come by Tuesday for your shot and it'll be waiting.",
    "Your flu shot is Tuesday, so collect it then.",
    "Your flu shot is Tuesday at 11 AM, and we'll deliver it then.",
    "Your vaccine appointment is Tuesday, and it ships that day.",
    "Your pickup is booked for your appointment Tuesday.",
  ])("blocks after a vaccine booking: %s", async (s) => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261124_1100" });
    expect(await say(s)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each([
    "Your vaccine appointment is Tuesday at 11 AM.",
    "Your vaccine appointment is booked for Tuesday the 24th at 11 AM.",
    "Your flu shot is Tuesday at 11 AM.",
    "You're booked for a vaccine on Tuesday at 11 AM.",
  ])("still allows the honest line: %s", async (s) => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261124_1100" });
    expect((await say(s)).blocked).toBe(false);
  });

  it("still allows offers of listed slots", async () => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "list_appointment_slots", { type: "vaccine" });
    for (const s of ["Would Tuesday at 11 AM work for your vaccine?", "I have vaccine openings Tuesday at 11 AM or Tuesday at 1 PM."]) expect((await say(s)).blocked, s).toBe(false);
    expect(await say("Would Tuesday at 11 AM work for your vaccine, and we'll have it ready then?")).toMatchObject({ blocked: true });
  });
});

describe("high 01M814W5WE: a history day backs nothing else in the sentence", () => {
  it.each([
    "You're eligible Tuesday, and we'll bring it then.",
    "You're eligible Tuesday, so it goes out then.",
    "You're eligible Tuesday, and it'll be sent that day.",
    "Your last fill was Saturday, and we'll deliver it the same day next week.",
    "Your last fill was Saturday; it's booked for then.",
    "You're eligible on Tuesday, which is when it arrives.",
  ])("blocks after refill_history: %s", async (s) => {
    const { control, callId, say } = await setup("jordan");
    await control.press(callId, "refill_history", { rx_id: IDS.p2Atorvastatin });
    expect(await say(s)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each(["You're eligible for your next refill on Tuesday.", "You'll be eligible for a refill on Tuesday the 8th.", "You last filled it on Saturday.", "Your last fill was on Saturday."])(
    "still allows the honest line: %s",
    async (s) => {
      const { control, callId, say } = await setup("jordan");
      await control.press(callId, "refill_history", { rx_id: IDS.p2Atorvastatin });
      expect((await say(s)).blocked).toBe(false);
    },
  );
});

describe("low 01M814W70Y: past-tense quantities only from refill_history", () => {
  it("a partial request's quantity backs present supply phrases, never the last fill", async () => {
    const { control, callId, say } = await setup("tom");
    await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 7 });
    expect((await say("Your refill is 7 tablets.")).blocked).toBe(false);
    expect(await say("Your last fill was 7 tablets.")).toMatchObject({ blocked: true, rule: "S3" });
    expect(await say("Last time you got 7 tablets.")).toMatchObject({ blocked: true, rule: "S3" });
  });

  it("the label's Qty backs no past fill until refill_history says so", async () => {
    const { control, callId, say } = await setup("tom");
    expect(await say("Last time you got 30 tablets.")).toMatchObject({ blocked: true, rule: "S3" });
    expect((await say("Your refill is 30 tablets.")).blocked).toBe(false);
    await control.press(callId, "refill_history", { rx_id: IDS.p6Amlodipine });
    expect((await say("Last time you got 30 tablets.")).blocked).toBe(false);
  });
});

describe("low 01M814W85D: 'cancelled' covers the whole sentence", () => {
  it("after a cancel, the order can't ride along in another clause", async () => {
    const { control, callId, say } = await setup("sam");
    const booked = await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261124_1100" });
    const id = booked.ok ? (booked.output as { appointment_id: string }).appointment_id : "";
    await control.press(callId, "cancel_appointment", { appointment_id: id });
    expect((await say("I've cancelled your flu shot.")).blocked).toBe(false);
    for (const s of ["I've cancelled your flu shot and your delivery.", "I've cancelled your flu shot, and your refill too.", "Your appointment and your order are cancelled."]) {
      expect(await say(s), s).toMatchObject({ blocked: true, rule: "S4" });
    }
  });
});
