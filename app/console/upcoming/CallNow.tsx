"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

// Starts the patient's outbound call through POST /api/outbound/call-now (rule 7 decides).
export function CallNow({ patientId, rxId }: { patientId: string; rxId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function call() {
    setBusy(true);
    const res = await fetch("/api/outbound/call-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, rxId }),
    });
    const body = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
    setBusy(false);
    setStatus(res.ok ? `Ringing (${body.callId})` : (body.error ?? `Failed (${res.status})`));
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={call}>
        Call now
      </Button>
      {status && (
        <span className="text-xs text-ink-3" aria-live="polite">
          {status}
        </span>
      )}
    </span>
  );
}
