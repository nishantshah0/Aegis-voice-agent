// 4.x (Trail #88), RT-SAFE-1: checkCallerLine hears crisis, emergency and handover lines in the
// forms people actually say and type them: look-alike letters, invisible characters, spelling
// and leetspeak, slang, overdose wording, typos, reactions, other languages, and other ways to
// ask for a person. False alarms are acceptable, misses are not; ordinary refill lines stay
// "continue" all the same.
import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { classify, createSafetyCheck } from "./safety";

const action = (line: string) => classify(line).action;

describe("crisis, however it's said", () => {
  it.each([
    "I want to kіll myself.",
    "I want to kill my​self.",
    "I want to k i l l myself.",
    "I've been thinking about su1cide.",
    "I want to unalive myself.",
    "Honestly, kms.",
    "I want to off myself.",
    "I don't want to be here anymore.",
    "I'm going to end things tonight.",
    "I'm going to end it.",
    "I won't be around much longer.",
    "I'm planning to take my own life.",
    "I just want to not wake up.",
    "I've been thinking about sucide.",
    "I want to kil myself.",
    "Quiero suicidarme.",
    "Je veux me tuer.",
  ])("%j is a crisis", (line) => {
    expect(action(line)).toBe("crisis");
  });
});

describe("emergencies, however they're said", () => {
  it.each([
    "I can't brеathe.",
    "I think I оverdosed.",
    "I took too ma​ny pills.",
    "I swallowed the whole bottle.",
    "I took all of them at once.",
    "I took 20 of my Concerta.",
    "I took a handful of pills.",
    "My kid ate my pills.",
    "I think I OD'd.",
    "I ODed on my meds.",
    "I took way more than I should have.",
    "I cant breath.",
    "I have chest pains.",
    "I think I overdoes.",
    "My throats closing up.",
    "My throat feels tight.",
    "I can barely breathe.",
    "I'm wheezing.",
    "My lips are puffy.",
    "I'm breaking out in welts.",
    "My heart is beating really fast.",
    "No puedo respirar.",
    "J'ai pris trop de comprimés.",
  ])("%j is an emergency", (line) => {
    expect(action(line)).toBe("emergency");
  });
});

describe("asking for a person, however it's said", () => {
  it.each(["Get me a pharmacist.", "Human please.", "Let me talk to a live agent.", "Can I speak with someone real?", "Put the pharmacist on."])(
    "%j is a handover",
    (line) => {
      expect(action(line)).toBe("handover");
    },
  );

  it.each(["我想自杀。", "मैं मरना चाहता हूँ।", "我吃了太多药。"])("%j, in a script the check can't read, goes to a person", (line) => {
    expect(action(line)).not.toBe("continue");
  });
});

describe("ordinary refill lines stay ordinary", () => {
  it.each([
    "Hi, this is Sam Rivera, I need my Concerta.",
    "I took my Concerta this morning.",
    "I take one every morning.",
    "That's odd.",
    "I'm out of pills.",
    "Can we end the call here?",
    "I'll pick it up tomorrow.",
    "My son picks it up for me.",
    "It's been a long week, but I'm fine.",
    "Yes, that's fine.",
    "The pharmacist said to take it with food.",
    "My birthday is March 14, 1990.",
    "It ends in 0101.",
    "Thanks, have a good day.",
    "I took the last one yesterday.",
    "Can you deliver it Thursday?",
  ])("%j continues", (line) => {
    expect(action(line)).toBe("continue");
  });
});

describe("a crisis line said as slang still moves the refill to Review", () => {
  it("'I want to unalive myself.' after a queued refill", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "112358" });
    const safety = createSafetyCheck({ store });
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    await control.press(callId, "check_code", { lookup_id: (lookup as { output: { lookup_id: string } }).output.lookup_id, code: "112358" });
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    expect((await safety(callId, "I want to unalive myself.")).action).toBe("crisis");
    expect((await store.queue("review")).some((q) => q.kind === "escalation")).toBe(true);
  });
});
