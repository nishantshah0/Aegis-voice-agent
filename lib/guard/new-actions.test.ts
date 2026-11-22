// Trail #85: what the guard lets the agent say back from the new buttons, and only after them.
// refill_history backs the last-fill weekday ("last fill"), the eligible weekday ("eligible") and
// the fill quantity (supply phrases only); appointments back their own day and time only in a
// clause that names an appointment and nothing being delivered; "booked" about an appointment
// needs a live booking, and "cancelled" a cancel. Nothing else loosens.
import { describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn } from "@/lib/contract";
import { freshLock, verifiedCall, CALLERS } from "@/lib/control/testing/verify";
import { IDS } from "@/lib/seed";
import { createSpeechGuard } from "./speech";

async function setup(who: keyof typeof CALLERS) {
  const lock = freshLock();
  const callId = await verifiedCall(lock.control, who);
  const guard: GuardSentenceFn = createSpeechGuard({ store: lock.store });
  const say = async (s: string) => guard(callId, s);
  return { ...lock, callId, say };
}

const allows = async (say: (s: string) => Promise<{ blocked: boolean }>, s: string) => expect((await say(s)).blocked, s).toBe(false);
const blocks = async (say: (s: string) => Promise<{ blocked: boolean; rule?: string }>, s: string, rule: string) => expect(await say(s), s).toMatchObject({ blocked: true, rule });

describe("refill_history read-backs", () => {
  it("blocks the last-fill and eligible days until refill_history is pressed", async () => {
    const { say } = await setup("jordan");
    await blocks(say, "You last filled it on Saturday.", "S4");
    await blocks(say, "You're eligible for your next refill on Tuesday.", "S4");
  });

  it("backs them after refill_history, in their own clauses only", async () => {
    const { control, callId, say } = await setup("jordan");
    await control.press(callId, "refill_history", { rx_id: IDS.p2Atorvastatin });
    for (const s of [
      "You last filled it on Saturday.",
      "Your last fill was on Saturday.",
      "You're eligible for your next refill on Tuesday.",
      "You'll be eligible for a refill on Tuesday the 8th.",
      "Last time you got 30 tablets.",
      "Your last fill was 30 tablets.",
      "That was a 30-day supply.",
      "Dr. Quillfeather is your prescriber.",
    ]) {
      await allows(say, s);
    }
  });

  it("still blocks a wrong day, a delivery promise and a dose dressed up as history", async () => {
    const { control, callId, say } = await setup("jordan");
    await control.press(callId, "refill_history", { rx_id: IDS.p2Atorvastatin });
    for (const [s, rule] of [
      ["You're eligible for your next refill on Wednesday.", "S4"],
      ["You last filled it on Friday.", "S4"],
      ["You're eligible on Tuesday, so we'll deliver it Tuesday.", "S4"],
      ["We'll deliver it Tuesday since you're eligible then.", "S4"],
      ["You last filled it Saturday and we'll bring the next one Saturday.", "S4"],
      ["Your refill is booked for Tuesday since you're eligible.", "S4"],
      ["Last time you got 60 tablets.", "S3"],
      ["Last time you got 30 tablets, take them all tonight.", "S3"],
      ["Take 30 tablets like last time.", "S3"],
      ["You're eligible, it's approved.", "S4"],
    ] as const) {
      await blocks(say, s, rule);
    }
  });

  it("a delivered last fill is history, not a promise; a delivery now still is", async () => {
    const { control, callId, say } = await setup("grace");
    await control.press(callId, "refill_history", { rx_id: IDS.p5Levothyroxine });
    await allows(say, "It was delivered last time.");
    await allows(say, "Last time it was delivered.");
    await blocks(say, "It was delivered.", "S4");
    await blocks(say, "It was delivered last time and it's delivered again today.", "S4");
  });

  it("never reads back another patient's history", async () => {
    const { control, callId, say } = await setup("sam");
    expect(await control.press(callId, "refill_history", { rx_id: IDS.p4Adderall })).toMatchObject({ ok: false });
    await blocks(say, "Dev's Adderall XR was last filled on Wednesday.", "S2");
  });
});

describe("partial-fill quantities", () => {
  it("backs the quantity request_refill worked out, in a supply phrase only", async () => {
    const { control, callId, say } = await setup("tom");
    await blocks(say, "Your refill is 7 tablets.", "S3");
    await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 7 });
    await allows(say, "Your refill is 7 tablets.");
    await allows(say, "That's a 7-day supply, 7 tablets.");
    await blocks(say, "Take 7 tablets tonight.", "S3");
    await blocks(say, "Your refill is 14 tablets.", "S3");
  });
});

describe("appointments", () => {
  it("offers only slots this call listed, in a clause about the appointment", async () => {
    const { control, callId, say } = await setup("sam");
    await blocks(say, "Would Thursday at 10 AM work for your consult?", "S4");
    await control.press(callId, "list_appointment_slots", { type: "consult" });
    await allows(say, "Would Thursday at 10 AM work for your consult?");
    await allows(say, "Thursday at 10 AM is open for a consult.");
    await allows(say, "I have consult openings Wednesday at 2 PM or Thursday at 10 AM.");
    await blocks(say, "Would Thursday at 11 AM work for your consult?", "S4");
    await blocks(say, "Would Sunday work for your consult?", "S4");
    await blocks(say, "Your consult is booked for Thursday at 10 AM.", "S4");
    await blocks(say, "We can deliver it Thursday at your consult.", "S4");
  });

  it("backs 'booked' and the slot's day and time only after book_appointment", async () => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" });
    await allows(say, "Your consult is booked for Thursday at 10 AM.");
    await allows(say, "You're booked for a consultation on Thursday the 26th at 10 AM.");
    await allows(say, "Your appointment is Thursday at 10.");
    await blocks(say, "Your consult is booked for Thursday at 2 PM.", "S4");
    await blocks(say, "Your consult is booked for Friday.", "S4");
    await blocks(say, "Your delivery is booked for Thursday.", "S4");
    await blocks(say, "Your refill is booked for Thursday.", "S4");
    await blocks(say, "We'll bring your refill to your appointment on Thursday.", "S4");
  });

  it("a pickup appointment backs a pickup time, never a delivery", async () => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "book_appointment", { slot_id: "ap_pickup_20261124_1200" });
    await allows(say, "Your pickup appointment is booked for Tuesday at 12 PM.");
    await allows(say, "Your pickup time is Tuesday at noon.");
    await blocks(say, "We'll deliver it Tuesday.", "S4");
    await blocks(say, "Your pickup appointment is Wednesday.", "S4");
  });

  it("another patient's booking backs nothing on this call", async () => {
    const lock = freshLock();
    const sam = await verifiedCall(lock.control, "sam");
    await lock.control.press(sam, "book_appointment", { slot_id: "ap_consult_20261126_1000" });
    const jordan = await verifiedCall(lock.control, "jordan");
    const guard = createSpeechGuard({ store: lock.store });
    expect(await guard(jordan, "Your consult is booked for Thursday at 10 AM.")).toMatchObject({ blocked: true, rule: "S4" });
  });

  it("a caller's booking from an earlier call is still theirs", async () => {
    const lock = freshLock();
    const first = await verifiedCall(lock.control, "sam");
    await lock.control.press(first, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" });
    await lock.control.endCall(first);
    const second = await verifiedCall(lock.control, "sam");
    const guard = createSpeechGuard({ store: lock.store });
    expect((await guard(second, "Your vaccine appointment is booked for Wednesday at 11 AM.")).blocked).toBe(false);
  });

  it("'cancelled' only after cancel_appointment, and a cancelled booking backs nothing", async () => {
    const { control, callId, say } = await setup("sam");
    const booked = await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" });
    await blocks(say, "Your appointment is cancelled.", "S4");
    await allows(say, "I can't cancel that appointment.");
    const id = booked.ok ? (booked.output as { appointment_id: string }).appointment_id : "";
    await control.press(callId, "cancel_appointment", { appointment_id: id });
    await allows(say, "Your appointment is cancelled.");
    await blocks(say, "Your consult is booked for Thursday at 10 AM.", "S4");
    await blocks(say, "Your delivery is cancelled.", "S4");
  });

  it("'confirmed' is still a completion word: say 'booked'", async () => {
    const { control, callId, say } = await setup("sam");
    await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" });
    await blocks(say, "Your consult is confirmed for Thursday.", "S4");
  });
});
