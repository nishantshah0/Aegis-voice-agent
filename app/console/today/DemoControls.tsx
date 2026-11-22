"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";

// Reset the demo and run the daily reminder check. The server decides who may
// (signed-in pharmacist or reviewer, or DEMO_CONTROLS=on on a demo laptop).
export function DemoControls() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(path: string, describe: (body: Record<string, unknown>) => string) {
    setBusy(true);
    const res = await fetch(path, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    setStatus(res.ok ? describe(body) : String(body.error ?? `Failed (${res.status})`));
    router.refresh();
  }

  return (
    <section className="mt-6 flex flex-wrap items-center gap-2" aria-label="Demo controls">
      <button
        type="button"
        disabled={busy}
        onClick={() => run("/api/demo/reset", (b) => `Reset. Demo clock: ${new Date(String(b.now)).toLocaleString()}`)}
        className={buttonClass("secondary", "sm")}
      >
        Reset demo
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run("/api/outbound/run-daily-check", (b) => {
            const rung = (b.callIds as string[] | undefined)?.length ?? 0;
            return rung === 0 ? "Daily check: nobody to ring right now." : `Daily check: ringing ${rung} patient${rung === 1 ? "" : "s"}.`;
          })
        }
        className={buttonClass("secondary", "sm")}
      >
        Run daily check
      </button>
      {/* Trail #70: a real call to the phone that stands in for Sam (TEST_PATIENT_PHONE, only in .env). */}
      <button
        type="button"
        disabled={busy}
        onClick={() => run("/api/voice/outbound", (b) => `Calling Sam's real phone (call ${String(b.callId)}). It shows up here like any other call.`)}
        className={buttonClass("secondary", "sm")}
      >
        Call Sam on a real phone
      </button>
      <span className="text-sm text-ink-3" aria-live="polite">
        {status}
      </span>
    </section>
  );
}
