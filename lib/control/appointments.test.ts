// Trail #85: appointments. Nishant's ask: "make it be able to book meets and appointments".
// Open slots come from the store's policy and clock; bookings live only in the record; every
// booking is the verified caller's own, in a free slot, in business hours, one per type per day.
import { describe, expect, it } from "vitest";
import { STARTING_CARDS, type ButtonResult, type RuleCard, type Seed } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { appointmentFloor, slotsFrom } from "./appointments";
import { applyApprovedCard } from "./cards";
import { freshLock, verifiedCall } from "./testing/verify";

const pharmacist = { id: "u_ph", name: "Test Pharmacist", role: "pharmacist" as const };

type Slots = { slots: { slot_id: string; label: string; start: string }[]; booked: { appointment_id: string; type: string }[] };
const out = <T>(r: ButtonResult): T => {
  if (!r.ok) throw new Error(`press failed: ${r.error}`);
  return r.output as T;
};

describe("open slots from the policy and the clock", () => {
  const slots = slotsFrom(SEED.now, SEED.policy);

  it("covers the next 14 days, after now, with none on Sundays and none outside 9 to 6", () => {
    expect(slots.length).toBeGreaterThan(40);
    for (const s of slots) {
      expect(Date.parse(s.start)).toBeGreaterThan(Date.parse(SEED.now));
      expect(Date.parse(s.start) - Date.parse(SEED.now)).toBeLessThanOrEqual(14 * 24 * 3600 * 1000);
      expect(s.start).toMatch(/-05:00$/);
      expect(s.label).not.toMatch(/sunday/i);
      const hour = Number(s.start.slice(11, 13));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(18);
    }
  });

  it("names the day and time without a month, ids say type, date and time", () => {
    const consult = slots.find((s) => s.type === "consult" && s.start === "2026-11-26T10:00:00-05:00");
    expect(consult).toMatchObject({ id: "ap_consult_20261126_1000", label: "Thursday the 26th at 10 AM", end: "2026-11-26T15:30:00.000Z" });
    expect(slots.find((s) => s.id === "ap_consult_20261124_1630")?.label).toBe("Tuesday the 24th at 4:30 PM");
    // Today's 10 AM consult has already started: not offered.
    expect(slots.some((s) => s.id === "ap_consult_20261124_1000")).toBe(false);
    for (const s of slots) expect(s.label).not.toMatch(/january|february|march|april|may|june|july|august|september|october|november|december/i);
  });

  it("uses the default schedule when a store's policy predates appointments", () => {
    expect(slotsFrom(SEED.now, { controlledEarlyWindowDays: 3 })).toEqual(slots);
  });
});

describe("list_appointment_slots", () => {
  it("needs a verified call", async () => {
    const { control } = freshLock();
    const callId = await control.startInboundCall();
    expect(await control.press(callId, "list_appointment_slots", { type: "consult" })).toMatchObject({ ok: false, error: "not_verified", ruleIds: ["1"] });
  });

  it("lists up to 10 open slots of one type, earliest first", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    const listed = out<Slots>(await control.press(callId, "list_appointment_slots", { type: "vaccine" }));
    expect(listed.slots).toHaveLength(10);
    expect(listed.slots[0]).toMatchObject({ slot_id: "ap_vaccine_20261124_1100", label: "Tuesday the 24th at 11 AM" });
    expect(listed.slots.every((s) => s.slot_id.startsWith("ap_vaccine_"))).toBe(true);
    expect(listed.booked).toEqual([]);
  });

  it("refuses a type that isn't one", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    expect(await control.press(callId, "list_appointment_slots", { type: "surgery" })).toMatchObject({ ok: false, error: "invalid_input" });
  });
});

describe("book_appointment and cancel_appointment", () => {
  it("needs a verified call, and books nothing", async () => {
    const { control, store } = freshLock();
    const callId = await control.startInboundCall();
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" })).toMatchObject({ ok: false, error: "not_verified" });
    expect(await control.press(callId, "cancel_appointment", { appointment_id: "apt_x" })).toMatchObject({ ok: false, error: "not_verified" });
    expect((await store.listRecord()).filter((e) => e.decision === "allowed" && e.button === "book_appointment")).toEqual([]);
  });

  it("books an open slot for the caller, puts it in the record, and takes it off the list", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "sam");
    const booked = await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" });
    expect(booked).toMatchObject({
      ok: true,
      output: { ok: true, rule_ids: [], appointment_id: `apt_${callId}_1`, type: "consult", label: "Thursday the 26th at 10 AM", start: "2026-11-26T10:00:00-05:00" },
    });
    const entry = (await store.listRecord(callId)).at(-1)!;
    expect(entry).toMatchObject({ button: "book_appointment", decision: "allowed", context: { "appointment.slot_free": true, "appointment.patient_is_caller": true } });
    const listed = out<Slots>(await control.press(callId, "list_appointment_slots", { type: "consult" }));
    expect(listed.slots.some((s) => s.slot_id === "ap_consult_20261126_1000")).toBe(false);
    expect(listed.booked).toEqual([{ appointment_id: `apt_${callId}_1`, type: "consult", label: "Thursday the 26th at 10 AM", start: "2026-11-26T10:00:00-05:00" }]);
  });

  it("refuses a slot that doesn't exist, a forged one outside hours, and junk input", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    for (const slot_id of ["ap_consult_20261126_1100", "ap_consult_20261126_2200", "ap_consult_20261129_1000", "slot_thu_am", "ap_consult_20270101_1000"]) {
      expect(await control.press(callId, "book_appointment", { slot_id }), slot_id).toMatchObject({ ok: false, error: "not_found" });
    }
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000", patient_id: "p_jordan" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await control.press(callId, "book_appointment", {})).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("13a: another caller can't take a slot that's booked", async () => {
    const { control } = freshLock();
    const sam = await verifiedCall(control, "sam");
    await control.press(sam, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" });
    const jordan = await verifiedCall(control, "jordan");
    expect(await control.press(jordan, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" })).toMatchObject({ ok: true, output: { ok: false, rule_ids: ["13a"] } });
    expect(out<Slots>(await control.press(jordan, "list_appointment_slots", { type: "vaccine" })).booked).toEqual([]);
  });

  it("13d: one booking per type per day, but another type or another day is fine", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    expect((await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" })).ok).toBe(true);
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1400" })).toMatchObject({ output: { ok: false, rule_ids: ["13d"] } });
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261126_1100" })).toMatchObject({ output: { ok: true } });
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261127_1000" })).toMatchObject({ output: { ok: true } });
  });

  it("cancel then rebook: the slot frees up, and the day's type limit resets", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    const first = out<{ appointment_id: string }>(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1000" }));
    expect(await control.press(callId, "cancel_appointment", { appointment_id: first.appointment_id })).toMatchObject({ ok: true, output: { ok: true } });
    expect(await control.press(callId, "cancel_appointment", { appointment_id: first.appointment_id })).toMatchObject({ ok: false, error: "not_found" });
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_consult_20261126_1400" })).toMatchObject({ output: { ok: true, appointment_id: `apt_${callId}_2` } });
    const jordan = await verifiedCall(control, "jordan");
    expect(await control.press(jordan, "book_appointment", { slot_id: "ap_consult_20261126_1000" })).toMatchObject({ output: { ok: true } });
  });

  it("rule 1: a caller can't cancel or see someone else's appointment", async () => {
    const { control } = freshLock();
    const sam = await verifiedCall(control, "sam");
    const booked = out<{ appointment_id: string }>(await control.press(sam, "book_appointment", { slot_id: "ap_med_review_20261126_1130" }));
    const jordan = await verifiedCall(control, "jordan");
    expect(await control.press(jordan, "cancel_appointment", { appointment_id: booked.appointment_id })).toMatchObject({ ok: false, error: "not_yours", ruleIds: ["1"] });
    expect(JSON.stringify(await control.press(jordan, "list_appointment_slots", { type: "med_review" }))).not.toContain(booked.appointment_id);
    expect(out<Slots>(await control.press(sam, "list_appointment_slots", { type: "consult" })).booked).toHaveLength(1);
  });

  it("can't cancel an appointment that has already started", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "sam");
    const booked = out<{ appointment_id: string }>(await control.press(callId, "book_appointment", { slot_id: "ap_pickup_20261124_1200" }));
    await store.setNow("2026-11-24T12:05:00-05:00");
    expect(await control.press(callId, "cancel_appointment", { appointment_id: booked.appointment_id })).toMatchObject({ ok: false, error: "refused" });
  });

  it("holds the rules in code too, on a store whose rule book predates cards 13a to 13e", async () => {
    const old: Seed = { ...SEED, cards: STARTING_CARDS.filter((c) => !c.id.startsWith("13")) };
    const { control } = freshLock(old);
    const sam = await verifiedCall(control, "sam");
    await control.press(sam, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" });
    expect(await control.press(sam, "book_appointment", { slot_id: "ap_vaccine_20261125_1300" })).toMatchObject({ output: { ok: false, rule_ids: ["13d"] } });
    const jordan = await verifiedCall(control, "jordan");
    expect(await control.press(jordan, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" })).toMatchObject({ output: { ok: false, rule_ids: ["13a"] } });
    expect(appointmentFloor({ "appointment.slot_free": true, "appointment.local_hour": 8, "appointment.same_type_same_day": 0, "appointment.patient_is_caller": true })).toEqual(["13b"]);
    expect(appointmentFloor({ "appointment.slot_free": true, "appointment.local_hour": 18, "appointment.same_type_same_day": 0, "appointment.patient_is_caller": true })).toEqual(["13c"]);
    expect(appointmentFloor({ "appointment.slot_free": true, "appointment.local_hour": 10, "appointment.same_type_same_day": 0, "appointment.patient_is_caller": false })).toEqual(["13e"]);
    expect(appointmentFloor({})).toEqual(["13a", "13b", "13c", "13d", "13e"]);
  });

  it("a schedule changed to open at 7 AM still can't book before 9 (card 13b)", async () => {
    const early: Seed = { ...SEED, policy: { ...SEED.policy, appointmentSchedule: [{ type: "vaccine", weekdays: [3], times: ["07:00"], minutes: 15 }] } };
    const { control } = freshLock(early);
    const callId = await verifiedCall(control, "sam");
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261125_0700" })).toMatchObject({ output: { ok: false, rule_ids: ["13b"] } });
  });

  it("an approver's route card sends a booking to the pharmacist instead", async () => {
    const { control, store } = freshLock();
    const draft: RuleCard = {
      id: "w-vax",
      wording: "Vaccine bookings after 3 PM need a pharmacist.",
      when: [{ field: "appointment.local_hour", op: ">=", value: 15 }],
      then: "route",
      appliesTo: ["book_appointment"],
      risk: "Late vaccines",
      author: "test",
      approvedBy: "",
      approvedAt: "",
      tests: [],
      live: false,
    };
    expect(await applyApprovedCard(store, draft, pharmacist)).toMatchObject({ ok: true });
    const callId = await verifiedCall(control, "sam");
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261125_1500" })).toMatchObject({ ok: true, lane: "review", output: { ok: false, rule_ids: ["w-vax"] } });
    expect((await store.queue("review")).at(-1)).toMatchObject({ kind: "note", ruleIds: ["w-vax"] });
    expect(await control.press(callId, "book_appointment", { slot_id: "ap_vaccine_20261125_1100" })).toMatchObject({ output: { ok: true } });
  });
});
