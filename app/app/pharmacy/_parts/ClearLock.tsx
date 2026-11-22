"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { dateTime } from "./format";

/** A patient's code lockout, as a small badge (Trail #86). */
export function LockBadge({ lockedUntil }: { lockedUntil: string }) {
  return (
    <Badge tone="stop" dot>
      Locked until {dateTime(lockedUntil)}
    </Badge>
  );
}

/**
 * The lockout and, for a pharmacist, the way to clear it early: Clear lockout, then a confirm,
 * then POST /api/patients/:id/code-lock/clear. The server takes the pharmacist from the session
 * and writes one approval entry to the record; the lock reads only the record.
 */
export function ClearLock({ patientId, who, lockedUntil, canClear }: { patientId: string; who: string; lockedUntil: string; canClear: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState("");

  async function clear() {
    setStep("busy");
    setError("");
    const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}/code-lock/clear`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error ?? `Failed (${res?.status ?? "network"})`);
      setStep("confirm");
      return;
    }
    setStep("idle");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="code-lock">
      <div className="flex flex-wrap items-center gap-2">
        <LockBadge lockedUntil={lockedUntil} />
        {canClear && step === "idle" && (
          <Button size="sm" variant="secondary" onClick={() => setStep("confirm")}>
            Clear lockout
          </Button>
        )}
      </div>
      {!canClear && <p className="text-xs text-ink-3">Too many wrong codes. Only a pharmacist can clear it early.</p>}
      {canClear && step !== "idle" && (
        <div role="alertdialog" aria-label={`Clear the code lockout for ${who}?`} className="flex flex-col gap-2 rounded-xl border border-line bg-sunken p-3 text-sm">
          <p>
            Clear the code lockout for <span className="font-medium">{who}</span>? Wrong codes before now stop counting. It&apos;s written to the record under your name.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="deny" disabled={step === "busy"} onClick={clear}>
              {step === "busy" ? "Clearing…" : "Clear it"}
            </Button>
            <Button size="sm" variant="ghost" disabled={step === "busy"} onClick={() => setStep("idle")}>
              Cancel
            </Button>
          </div>
          {error && (
            <p className="text-stop" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
