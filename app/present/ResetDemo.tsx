"use client";

import { useState } from "react";

// Trail #70: the presenter's emergency Reset demo, between judges. Clears every call, order and
// queue item and puts the demo clock back to the seed's Tuesday 10 AM, after a confirmation.
export function ResetDemo() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (!window.confirm("Reset the demo? This clears every call, order and queue item for everyone.")) return;
    setBusy(true);
    setStatus("Resetting…");
    try {
      const res = await fetch("/api/presenter/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "reset" }) });
      const body = (await res.json().catch(() => ({}))) as { now?: string; error?: string };
      setStatus(res.ok ? `Demo reset. Demo clock: ${new Date(String(body.now)).toLocaleString()}` : (body.error ?? `Reset failed (${res.status})`));
    } catch {
      setStatus("Reset failed: no connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="presenter-reset" aria-label="Reset demo">
      <button type="button" onClick={reset} disabled={busy} className="presenter-secondary">
        Reset demo
      </button>
      <span aria-live="polite">{status}</span>
    </section>
  );
}
