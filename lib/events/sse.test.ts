import { afterEach, describe, expect, it } from "vitest";
import { emit, resetBusForTests } from "./bus";
import { createEventStream, parseLastEventId, sseFrame } from "./sse";

afterEach(() => resetBusForTests());

const decoder = new TextDecoder();

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

describe("sseFrame", () => {
  it("writes id and JSON data, ending with a blank line", () => {
    const frame = sseFrame({ id: 7, event: { type: "clock", now: "2026-01-01T00:00:00.000Z" } });
    expect(frame).toBe('id: 7\ndata: {"type":"clock","now":"2026-01-01T00:00:00.000Z"}\n\n');
  });
});

describe("parseLastEventId", () => {
  it("accepts whole numbers and rejects anything else", () => {
    expect(parseLastEventId("12")).toBe(12);
    expect(parseLastEventId(null)).toBeNull();
    expect(parseLastEventId("")).toBeNull();
    expect(parseLastEventId("abc")).toBeNull();
    expect(parseLastEventId("-1")).toBeNull();
    expect(parseLastEventId("1.5")).toBeNull();
  });
});

describe("createEventStream", () => {
  it("sends events emitted after it opens, and closes on abort", async () => {
    const abort = new AbortController();
    const reader = createEventStream(abort.signal, null).getReader();
    await readUntil(reader, ": connected");

    emit({ type: "line", callId: "call_test", who: "caller", text: "Hello" });
    const text = await readUntil(reader, "Hello");
    expect(text).toContain('"type":"line"');

    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });

  it("replays missed events after Last-Event-ID without repeating any", async () => {
    emit({ type: "clock", now: "2026-01-01T00:00:00.000Z" }); // id 1
    emit({ type: "clock", now: "2026-01-02T00:00:00.000Z" }); // id 2
    const abort = new AbortController();
    const reader = createEventStream(abort.signal, 1).getReader();
    const text = await readUntil(reader, "id: 2");
    expect(text).not.toContain("id: 1\n");
    expect(text).toContain("2026-01-02");
    abort.abort();
  });
});

describe("the public stream never carries verification codes (Trail #3)", () => {
  it("drops phone code events live and on replay, and still sends ring and status", async () => {
    emit({ type: "phone", callId: "c_1", kind: "code", text: "Your pharmacy verification code is 123456." }); // id 1
    emit({ type: "phone", callId: "c_1", kind: "ring", text: "Maple Street Pharmacy is calling" }); // id 2
    const abort = new AbortController();
    const reader = createEventStream(abort.signal, 0).getReader();
    emit({ type: "phone", callId: "c_1", kind: "code", text: "Your pharmacy verification code is 654321." }); // id 3
    emit({ type: "phone", callId: "c_1", kind: "status", text: "Approved by the pharmacist" }); // id 4
    const text = await readUntil(reader, "Approved by the pharmacist");
    expect(text).toContain('"kind":"ring"');
    expect(text).not.toContain('"kind":"code"');
    expect(text).not.toMatch(/123456|654321/);
    abort.abort();
  });
});

describe("the hello frame", () => {
  it("opens every stream with a named hello event, so pages can tell the stream really flows", async () => {
    const abort = new AbortController();
    const reader = createEventStream(abort.signal, null).getReader();
    const text = await readUntil(reader, "event: hello");
    expect(text).toContain("event: hello\ndata: {}\n\n");
    abort.abort();
  });
});
