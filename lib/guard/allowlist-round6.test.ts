// 4.x (Trail #88), round 6: the last two red-team corpus lines.
//   S4: a delivery or a completion said in Spanish or French needs the record like in English
//   S1/S2: a drug or a name spelled by its first letters ("starts with C-O-N") is the drug or name
// Honest lines stay spoken: "starts with" about anything else.
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

const CODE = "112358";
let store: Store;
let control: Control;
let guard: GuardSentenceFn;

beforeEach(() => {
  store = createMemoryStore(SEED);
  control = createControl({ store, makeCode: () => CODE });
  guard = createSpeechGuard({ store });
});

async function verifiedSam(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup");
  await control.press(callId, "check_code", { lookup_id: (lookup.output as { lookup_id: string }).lookup_id, code: CODE });
  return callId;
}

const rule = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

describe("S4 in Spanish and French", () => {
  it.each([
    "Lo entregamos el viernes.",
    "Se lo entregamos mañana.",
    "Nous le livrons vendredi.",
    "On vous le livre demain.",
    "Su receta está lista.",
    "Su medicamento está listo.",
    "C'est prêt.",
    "Votre ordonnance est prête.",
  ])("blocks %j with nothing booked or approved", async (sentence) => {
    expect(await rule(await verifiedSam(), sentence)).toBe("S4");
  });
});

describe("a drug or a name spelled by its first letters", () => {
  it.each(["The medication that starts with C-O-N is due.", "Your medication starts with C O N.", "Is your last name the one that starts with R-I-V?"])(
    "S1 blocks %j before verification",
    async (sentence) => {
      expect(await rule(await control.startInboundCall(), sentence)).toBe("S1");
    },
  );

  it("S2 blocks another patient's drug by its first letters", async () => {
    expect(await rule(await verifiedSam(), "Your neighbour's medicine starts with A-D-D.")).toBe("S2");
  });

  it.each(["The call starts with me checking a few details.", "It begins with a quick question.", "Each refill starts with a pharmacist check."])(
    "passes %j",
    async (sentence) => {
      expect(await rule(await control.startInboundCall(), sentence)).toBeNull();
    },
  );
});
