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
