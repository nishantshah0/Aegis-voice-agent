"use client";

import { useEffect, useState } from "react";
import { listenToEvents } from "@/lib/events/client";
import { buttonClass } from "@/components/ui";
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
          className={buttonClass("secondary", "sm")}
        >
          Set demo clock to now
        </button>
        <span className="text-sm text-ink-3" aria-live="polite">{status}</span>
      </div>
      <h2 className="mt-6 text-[22px] leading-tight">Live events</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">Waiting for events on /api/events…</p>
      ) : (
        <ol className="mt-2 max-h-96 space-y-1 overflow-y-auto rounded-xl bg-sunken p-3 font-mono text-xs text-ink-2" data-testid="event-feed">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="text-ink-3">#{row.id}</span> <strong>{row.event.type}</strong>{" "}
              {JSON.stringify(row.event)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
