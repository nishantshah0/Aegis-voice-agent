import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { codeIn, initialPhone, phoneReducer, type PhoneAction, type PhoneState } from "./state";

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
    expect(s).toMatchObject({ code: "112358", status: "Approved, ready Thursday" });
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

  it("finds six-digit codes only", () => {
    expect(codeIn("Your code is 112358.")).toBe("112358");
    expect(codeIn("Call 555-0101")).toBeUndefined();
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
