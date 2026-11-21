"use client";

import { useEffect, useState } from "react";
import { listenToEvents } from "@/lib/events/client";
import type { StreamEvent } from "@/lib/events/types";

type Row = { id: number; event: StreamEvent };

// Live view of /api/events. A debugging aid until task 2.3 builds the real
// Today view; it stays useful as a raw feed for the team.
export function EventFeed() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");

  useEffect(
    () => listenToEvents((event, id) => setRows((prev) => [{ id, event }, ...prev].slice(0, 100))),
    [],
  );

  async function sendClockEvent() {
    const res = await fetch("/api/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ now: new Date().toISOString() }),
    });
    setStatus(res.ok ? "Sent" : `Failed: ${res.status}`);
  }

  return (
    <section className="mt-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={sendClockEvent}
          className="rounded border border-neutral-400 px-3 py-1.5 text-sm hover:opacity-75"
        >
          Set demo clock to now
        </button>
        <span className="text-sm text-neutral-500" aria-live="polite">{status}</span>
      </div>
      <h2 className="mt-6 text-lg font-medium">Live events</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">Waiting for events on /api/events…</p>
      ) : (
        <ol className="mt-2 space-y-1 font-mono text-sm" data-testid="event-feed">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="text-neutral-400">#{row.id}</span> <strong>{row.event.type}</strong>{" "}
              {JSON.stringify(row.event)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
