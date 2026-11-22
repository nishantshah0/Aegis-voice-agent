import { APPOINTMENT_CONFIRMATION_QUESTION, confirmsBooking } from "@/lib/contract/appointment-consent";
import type { AppointmentOffer } from "@/lib/contract/buttons";
import { createControl } from "@/lib/control";
import { createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { demoCode, equal } from "./config";

export type Phase = "pin" | "menu" | "confirm" | "appointment" | "end";
export type Flow = {
  phase: Phase;
  verified: boolean;
  attempts: number;
  requested: boolean;
  offered?: AppointmentOffer;
  appointmentBooked?: string;
  reply: string;
};
const menu =
  "For last fill, press one or say history. For a seven-day price, press two. For a refill, press three. For a pharmacist appointment, press four. Or press zero to finish.";
export const first: Flow = {
  phase: "pin",
  verified: false,
  attempts: 0,
  requested: false,
  reply:
    "Hi, this is Aegis calling for a fictional pharmacy demonstration. No real prescription will be changed. Say the six digits shown on the presenter screen, one digit at a time, or enter them on your keypad.",
};
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const digitWords: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

function spokenPin(said: string) {
  const words = said.replace(/^(?:(?:my|the) (?:demo )?code is|it is|it s) /, "").split(" ");
  return words.map(word => /^\d+$/.test(word) ? word : digitWords[word] ?? "?").join("");
}

async function verifiedRecord(id: string) {
  // A persisted successful demo PIN authorizes this synthetic patient only. Rebuild
  // the verified control session from that fact on any serverless instance.
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => demoCode(id) });
  const patient = await store.getPatient(IDS.p6),
    rx = await store.getPrescription(IDS.p6Amlodipine);
  if (!patient || !rx) throw new Error("Unavailable fixture");
  const call = await control.startInboundCall();
  const lookup = await control.press(call, "lookup_patient", {
    name: patient.firstName + " " + patient.lastName,
    dob: patient.dob,
    rx_number: rx.rxNumber,
  });
  if (!lookup.ok) throw new Error("Unavailable identity");
  const auth = await control.press(call, "check_code", {
    lookup_id: lookup.output.lookup_id,
    code: demoCode(id),
  });
  if (!auth.ok || !("verified" in auth.output) || !auth.output.verified)
    throw new Error("Unavailable identity");
  const guard = createSpeechGuard({ store });
  return { store, control, rx, call, guard };
}
async function recordAnswer(id: string, action: "history" | "price" | "refill") {
  const { control, rx, call, guard } = await verifiedRecord(id);
  let text: string;
  if (action === "history") {
    const result = await control.press(call, "check_prescription", {
      rx_id: rx.id,
      include_other_names: false,
    });
    if (!result.ok || !result.output.history_readback) throw new Error("Unavailable history");
    text = result.output.history_readback;
  } else if (action === "price") {
    const result = await control.press(call, "check_coverage", { rx_id: rx.id, days_supply: 7 });
    if (!result.ok) throw new Error("Unavailable quote");
    text = result.output.coverage_readback;
  } else {
    const result = await control.press(call, "request_refill", { rx_id: rx.id, days_supply: 7 });
    if (!result.ok || !result.output.order_id || !result.output.supply_text)
      throw new Error("Unable to request refill");
    text = result.output.supply_text;
  }
  return (await guard(call, text)).speak;
}

async function appointment(id: string, previous: Flow, digits: string, said: string): Promise<Flow> {
  const back = (reply: string): Flow => ({
    ...previous,
    offered: undefined,
    phase: "menu",
    reply: reply + " " + menu,
  });
  if (previous.appointmentBooked)
    return back("Your demo pharmacist appointment is booked for " + previous.appointmentBooked + ".");
  const { control, call, guard, store } = await verifiedRecord(id);
  const listed = await control.press(call, "order_status", { include_appointments: true });
  if (!listed.ok) return back("I couldn't retrieve the pharmacist's schedule.");
  const slots = listed.output.appointment_slots ?? [];
  const pending = previous.phase === "appointment" && previous.offered;
  if (pending && (digits === "1" || confirmsBooking(said))) {
    const current = slots.find(
      (slot) => slot.slot_id === pending.slot_id && slot.availability_text === pending.availability_text,
    );
    if (!current) return back("That time is no longer available.");
    // Restore the actual prior lines and caller reply into the new control session.
    if (!previous.reply.endsWith(current.availability_text + " " + APPOINTMENT_CONFIRMATION_QUESTION))
      return back("Let's check the time again.");
    await guard(call, current.availability_text);
    await guard(call, APPOINTMENT_CONFIRMATION_QUESTION);
    await store.appendRecord({
      callId: call,
      actor: "caller",
      kind: "caller_line",
      input: { text: digits === "1" ? "Yes" : said },
    });
    const result = await control.press(call, "note_for_pharmacist", {
      kind: "appointment",
      slot_id: current.slot_id,
    });
    if (!result.ok || !("confirmation_text" in result.output)) return back("I couldn't book that time.");
    return {
      ...back((await guard(call, result.output.confirmation_text)).speak),
      appointmentBooked: current.slot_label,
    };
  }
  if (pending && (digits === "2" || /^(?:no|no thanks|cancel|never mind)$/.test(said)))
    return back("I left the appointment unbooked.");
  const namedDay = said.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[0];
  const explicitTime = said.match(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (explicitTime && explicitTime[2] && explicitTime[2] !== "00")
    return back("I don't have that exact appointment time in the demo.");
  const exactTime = explicitTime ? explicitTime[1] + " " + explicitTime[3] : undefined;
  const slot =
    digits === "3" && pending
      ? slots.find((slot) => slot.slot_id !== pending.slot_id)
      : slots.find(
          (slot) =>
            (!namedDay || slot.slot_label.toLowerCase().startsWith(namedDay)) &&
            (!exactTime || slot.slot_label.toLowerCase().includes("at " + exactTime + " ")),
        );
  if (!slot) return back("I don't have a matching appointment in the demo schedule.");
  if (pending && !namedDay && !exactTime && digits !== "3") return back("I left the appointment unbooked.");
  const offer = (await guard(call, slot.availability_text)).speak;
  const question = (await guard(call, APPOINTMENT_CONFIRMATION_QUESTION)).speak;
  if (offer !== slot.availability_text || question !== APPOINTMENT_CONFIRMATION_QUESTION)
    return back("I couldn't verify the offered time.");
  return {
    ...previous,
    phase: "appointment",
    offered: slot,
    reply:
      "Say yes or press one to book, two to decline, or three for another time. " + offer + " " + question,
  };
}

export async function nextFlow(id: string, previous: Flow, digits: string, speech: string): Promise<Flow> {
  if (previous.phase === "end") return previous;
  const finish = (reply: string) => ({ ...previous, phase: "end" as const, reply });
  const said = normalize(speech);
  if (previous.phase === "pin") {
    const entered = digits || spokenPin(said);
    if (/^\d{6}$/.test(entered) && equal(entered, demoCode(id)))
      return { ...previous, verified: true, phase: "menu", reply: "You're in the fictional record. " + menu };
    const attempts = previous.attempts + 1;
    if (attempts >= 3) return finish("We couldn't verify the demo code. Goodbye.");
    return {
      ...previous,
      attempts,
      reply: "That code didn't match. Say or enter the six digits from the presenter screen.",
    };
  }
  if (!previous.verified) return finish("The demo record is unavailable. Goodbye.");
  if (digits === "0" || /^(?:bye|goodbye|stop|finish|hang up|thats all|that s all)$/.test(said))
    return finish("Thanks for trying the Aegis demo. Goodbye.");
  if (
    previous.phase === "appointment" ||
    digits === "4" ||
    /\b(?:appointment|schedule|consultation)\b/.test(said)
  ) {
    return appointment(id, previous, digits, said);
  }
  if (previous.phase === "confirm") {
    if (digits === "1" || /^(?:yes|yes please|confirm|please do|go ahead)$/.test(said)) {
      return {
        ...previous,
        phase: "menu",
        requested: true,
        reply: (await recordAnswer(id, "refill")) + " This was a demo request. " + menu,
      };
    }
    return { ...previous, phase: "menu", reply: "I left the refill unchanged. " + menu };
  }
  if (digits === "1" || /\b(?:last fill|last refill|history|last filled|last pickup|last picked up)\b/.test(said))
    return { ...previous, reply: (await recordAnswer(id, "history")) + " " + menu };
  if (digits === "2" || /\b(?:how much|quote|price|cost|pay|insurance|copay)\b/.test(said))
    return { ...previous, reply: (await recordAnswer(id, "price")) + " " + menu };
  if (digits === "3" || /\brefill\b/.test(said)) {
    if (previous.requested)
      return { ...previous, reply: "The seven-day demo refill was already requested. " + menu };
    return {
      ...previous,
      phase: "confirm",
      reply:
        "Would you like to request a seven-day demo refill? Say yes or press one to confirm. Say no or press two to go back.",
    };
  }
  return { ...previous, reply: "This demo can help with the sample prescription. " + menu };
}
