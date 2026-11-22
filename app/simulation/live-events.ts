export type TestEvent =
  | { type: "start"; scenarioId: string }
  | { type: "line"; speaker: "caller" | "pharmacy"; text: string; ticket?: string }
  | { type: "action"; label: string }
  | { type: "check"; label: string; passed: boolean }
  | { type: "verdict"; passed: boolean; caught: number; broken: number }
  | { type: "error"; message: string };

export type TestSource = "live" | "saved";

export function requestTest(source: TestSource, scenarioId: string, signal: AbortSignal) {
  if (source === "saved") {
    return fetch(`/api/simulation/live/latest?scenarioId=${encodeURIComponent(scenarioId)}`, { method: "GET", cache: "no-store", signal });
  }
  return fetch("/api/simulation/live", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId }), signal,
  });
}

function parse(raw: string): TestEvent {
  const e = JSON.parse(raw) as TestEvent;
  if (e?.type === "start" && typeof e.scenarioId === "string") return e;
  if (e?.type === "line" && ["caller", "pharmacy"].includes(e.speaker) && typeof e.text === "string") return e;
  if (e?.type === "action" && typeof e.label === "string") return e;
  if (e?.type === "check" && typeof e.label === "string" && typeof e.passed === "boolean") return e;
  if (e?.type === "verdict" && typeof e.passed === "boolean" && Number.isInteger(e.caught) && Number.isInteger(e.broken)) return e;
  if (e?.type === "error" && typeof e.message === "string") return e;
  throw new Error("The test returned an unreadable event.");
}

export async function readTestEvents(response: Response, receive: (e: TestEvent) => void) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `Could not start test (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error("The test returned no event stream.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += value ?? "";
      const rows = pending.split("\n");
      pending = done ? "" : rows.pop()!;
      for (const row of rows) {
        if (!row.trim()) continue;
        const event = parse(row);
        receive(event);
        if (event.type === "verdict" || event.type === "error") return;
      }
      if (done) throw new Error("The connection ended before the test returned a verdict.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
