// Trail #19: once the audience filter is on, a phone sees its call's lines only on its own
// token stream. The opening (opener, code sent) happens inside the answer request, before
// that stream connects, so the phone takes it from the answer response instead.
import { describe, expect, it } from "vitest";
import type { AgentEvent, StreamEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { forAudience, type Audience } from "@/lib/events/audience";
import { createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { CODE_SENT_MESSAGE, initialPhone, phoneListener, phoneReducer, type PhoneAction, type PhoneState } from "./state";

const play = (actions: PhoneAction[], from: PhoneState = initialPhone()) => actions.reduce(phoneReducer, from);

describe("which stream the phone listens to", () => {
  it("the plain stream until it's in a call with a token, then its own call's stream", () => {
    expect(phoneListener(initialPhone())).toBeUndefined();
    const ringing = play([{ type: "event", event: { type: "phone", callId: "c_1", kind: "ring", text: "Calling" } }]);
    expect(phoneListener(ringing)).toBeUndefined();
    expect(phoneListener(play([{ type: "connected", callId: "c_1" }], ringing))).toBeUndefined();
    const inCall = play([{ type: "connected", callId: "c_1", phoneToken: "tok" }], ringing);
    expect(phoneListener(inCall)).toEqual({ callId: "c_1", token: "tok" });
    expect(phoneListener(play([{ type: "hung_up" }], inCall))).toBeUndefined();
  });
});

describe("the opening from the answer response", () => {
  it("shows the opener and any blocked line, and the code-sent message so the phone fetches its code", () => {
    const events: AgentEvent[] = [
      { type: "line", text: "Hi, this is Maple Street Pharmacy calling for Sam." },
      { type: "press", button: "send_code", input: {}, result: { ok: true, output: { message: "code sent if matched" }, ruleIds: [] } },
      { type: "blocked_line", rule: "S1", original: "", replacement: "I can't share that yet." },
    ];
    const s = play([{ type: "connected", callId: "c_1", phoneToken: "tok" }, { type: "opening", events }]);
    expect(s.transcript).toEqual([
      { kind: "line", who: "agent", text: "Hi, this is Maple Street Pharmacy calling for Sam." },
      { kind: "blocked", rule: "S1", original: "", replacement: "I can't share that yet." },
    ]);
    expect(s.message).toBe(CODE_SENT_MESSAGE);
    expect(s.code).toBeUndefined();
  });

  it("doesn't show a code message when send_code failed", () => {
    const events: AgentEvent[] = [{ type: "press", button: "send_code", input: {}, result: { ok: false, error: "rate_limited", ruleIds: [] } }];
    expect(play([{ type: "connected", callId: "c_1" }, { type: "opening", events }]).message).toBeUndefined();
  });
});

describe("Sam's lines through the real audience filter", () => {
  async function samsEvents(): Promise<{ callId: string; events: StreamEvent[] }> {
    const store = createMemoryStore(SEED);
    const events: StreamEvent[] = [];
    const emit = (e: StreamEvent) => events.push(e);
    const control = createControl({ store, emit, makeCode: () => "112358" });
    const guard = createSpeechGuard({ store, emit });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused Sam");
    // As the driver does: each sentence through the guard, then the spoken line on the stream.
    const say = async (text: string) => emit({ type: "line", callId: started.callId, who: "agent", text: (await guard(started.callId, text)).speak });
    await say("Hi, this is Maple Street Pharmacy calling for Sam.");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    await say("Could you read me the code?");
    return { callId: started.callId, events };
  }
  const seen = (callId: string, events: StreamEvent[], audience: Audience) =>
    play([
      { type: "connected", callId },
      ...events.flatMap((e) => {
        const shaped = forAudience(e, audience);
        return shaped ? [{ type: "event", event: shaped } as PhoneAction] : [];
      }),
    ]);

  it("the call's own token stream shows his lines and the code-sent message", async () => {
    const { callId, events } = await samsEvents();
    const s = seen(callId, events, { kind: "phone", callId });
    expect(s.transcript.map((t) => (t.kind === "line" ? t.text : ""))).toEqual(["Hi, this is Maple Street Pharmacy calling for Sam.", "Could you read me the code?"]);
    expect(s.message).toBe(CODE_SENT_MESSAGE);
  });

  it("the public stream shows none of them, which is why the phone needs its token", async () => {
    const { callId, events } = await samsEvents();
    expect(seen(callId, events, { kind: "public" }).transcript).toEqual([]);
  });
});
