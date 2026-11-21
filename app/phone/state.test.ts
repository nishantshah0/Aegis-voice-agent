import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { initialPhone, phoneReducer, type PhoneAction, type PhoneState } from "./state";

const play = (actions: PhoneAction[], from: PhoneState = initialPhone()) => actions.reduce(phoneReducer, from);
const ev = (event: StreamEvent): PhoneAction => ({ type: "event", event });

describe("1.4: the phone's state, from events", () => {
  it("rings for a call, and connects when answered", () => {
    const ringing = play([ev({ type: "phone", callId: "c_1", kind: "ring", text: "Maple Street Pharmacy is calling" })]);
    expect(ringing).toMatchObject({ mode: "ringing", callId: "c_1", ringText: "Maple Street Pharmacy is calling" });
    expect(play([{ type: "connected", callId: "c_1" }], ringing)).toMatchObject({ mode: "in_call", callId: "c_1" });
  });

  it("ignores a second ring during a call", () => {
    const inCall = play([ev({ type: "phone", callId: "c_1", kind: "ring", text: "a" }), { type: "connected", callId: "c_1" }]);
    expect(play([ev({ type: "phone", callId: "c_2", kind: "ring", text: "b" })], inCall)).toBe(inCall);
  });

  it("keeps only this call's lines, codes and status", () => {
    const s = play([
      { type: "connected", callId: "c_1" },
      ev({ type: "line", callId: "c_1", who: "agent", text: "Hello." }),
      ev({ type: "line", callId: "c_2", who: "agent", text: "Someone else's call." }),
      ev({ type: "line", callId: "c_1", who: "caller", text: "Hi." }),
      ev({ type: "phone", callId: "c_1", kind: "code", text: "Your pharmacy verification code is 112358." }),
      ev({ type: "phone", callId: "c_2", kind: "status", text: "Not mine" }),
      ev({ type: "phone", callId: "c_1", kind: "status", text: "Approved, ready Thursday" }),
    ]);
    expect(s.transcript).toEqual([
      { kind: "line", who: "agent", text: "Hello." },
      { kind: "line", who: "caller", text: "Hi." },
    ]);
    expect(s).toMatchObject({ message: "Your pharmacy verification code is 112358.", status: "Approved, ready Thursday" });
    // The code itself comes only from the phone's own code route, never from the shared stream.
    expect(s.code).toBeUndefined();
  });

  it("shows a blocked line with its rule, and the replacement as the agent's next line", () => {
    const s = play([
      { type: "connected", callId: "c_1" },
      ev({ type: "blocked_line", callId: "c_1", rule: "S4", original: "It's approved.", replacement: "A pharmacist will check it first." }),
      ev({ type: "line", callId: "c_1", who: "agent", text: "A pharmacist will check it first." }),
    ]);
    expect(s.transcript).toEqual([
      { kind: "blocked", rule: "S4", original: "It's approved.", replacement: "A pharmacist will check it first." },
      { kind: "line", who: "agent", text: "A pharmacist will check it first." },
    ]);
  });

  it("keeps a code text that holds no digits, for the phone to fetch its own code", () => {
    const s = play([{ type: "connected", callId: "c_1" }, ev({ type: "phone", callId: "c_1", kind: "code", text: "A verification code was sent to your phone." })]);
    expect(s).toMatchObject({ message: "A verification code was sent to your phone." });
    expect(s.code).toBeUndefined();
    expect(play([{ type: "code", code: "246810" }], s).code).toBe("246810");
  });

  it("forgets the fetched code when a new code is sent", () => {
    const s = play([{ type: "connected", callId: "c_1" }, { type: "code", code: "246810" }, ev({ type: "phone", callId: "c_1", kind: "code", text: "A new code was sent." })]);
    expect(s.code).toBeUndefined();
  });

  it("starts clean when dialling, and ends on hang up", () => {
    const dialled = play([{ type: "connected", callId: "c_1" }, ev({ type: "line", callId: "c_1", who: "agent", text: "x" }), { type: "dial" }]);
    expect(dialled).toEqual({ mode: "dialling", transcript: [] });
    expect(play([{ type: "hung_up" }], dialled).mode).toBe("ended");
  });
});

describe("1.4: the phone keeps its call's token", () => {
  it("keeps the token from start or answer, and drops it on a new call", () => {
    const answered = play([{ type: "connected", callId: "c_1" }, { type: "connected", callId: "c_1", phoneToken: "tok_1" }]);
    expect(answered.phoneToken).toBe("tok_1");
    expect(play([{ type: "connected", callId: "c_1" }], answered).phoneToken).toBe("tok_1");
    expect(play([{ type: "dial" }], answered).phoneToken).toBeUndefined();
  });
});

describe("1.4: the opening shows once (demo step 2, URGENT 17:32)", () => {
  const opener = "This is Maple Street Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.";
  const openingEvents = [{ type: "line" as const, text: opener }];
  const streamOpener = ev({ type: "line", callId: "c_1", who: "agent", text: opener });
  const agentLines = (s: PhoneState) => s.transcript.filter((t) => t.kind === "line" && t.who === "agent").length;

  it("when the answer response comes first and the stream repeats it", () => {
    const s = play([{ type: "connected", callId: "c_1" }, { type: "opening", events: openingEvents }, streamOpener]);
    expect(agentLines(s)).toBe(1);
  });

  it("when the stream comes first and the answer response repeats it", () => {
    const s = play([{ type: "connected", callId: "c_1" }, streamOpener, { type: "opening", events: openingEvents }]);
    expect(agentLines(s)).toBe(1);
  });

  it("still shows a line said again later in the call", () => {
    const s = play([
      { type: "connected", callId: "c_1" },
      { type: "opening", events: openingEvents },
      ev({ type: "line", callId: "c_1", who: "caller", text: "Sorry, say that again?" }),
      streamOpener,
    ]);
    expect(agentLines(s)).toBe(2);
  });
});
