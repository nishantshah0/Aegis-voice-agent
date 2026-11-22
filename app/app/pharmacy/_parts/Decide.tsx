"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DecideResponse, QueueItem } from "@/lib/contract";
import { buttonClass, cn } from "@/components/ui";

export type Decision = "approve" | "deny";

/**
 * Approve or decline one queue item through POST /api/queue/:id/decide. The server takes
 * the approver from the Auth0 session and checks the role; nothing here says who decides.
 */
export function useDecide(onDecided?: (item: QueueItem) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState<string | null>(null);
  async function decide(id: string, decision: Decision, note?: string) {
    if (busy || stale === id) return false;
    setBusy(id);
    setError("");
    const text = note?.trim();
    const res = await fetch(`/api/queue/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(text ? { decision, note: text } : { decision }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      if (res?.status === 409 || res?.status === 404) {
        setStale(id);
        setError("This item changed. Refreshing the call outcome.");
        router.refresh();
      } else {
        setError(body?.error ?? "Could not record the decision. Try again.");
      }
      setBusy(null);
      return false;
    }
    if (onDecided) {
      const body = (await res.json().catch(() => null)) as DecideResponse | null;
      if (body?.item) onDecided(body.item);
    }
    setBusy(null);
    router.refresh();
    return true;
  }
  return { decide, busy, error, stale };
}

/** The note box and the two buttons, for one item. */
export function DecideBar({ id, className, disabled, onDecided }: {
  id: string;
  className?: string;
  disabled?: boolean;
  onDecided?: (item: QueueItem) => void;
}) {
  const { decide, busy, error, stale } = useDecide(onDecided);
  const [note, setNote] = useState("");
  const unavailable = disabled || busy === id || stale === id;
  const buttonState = "aria-disabled:cursor-default aria-disabled:opacity-45";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Note for the record"
          placeholder="Note (optional), e.g. chat at pickup"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          readOnly={busy === id || stale === id}
          className="h-9 min-w-0 basis-full rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button type="button" aria-disabled={unavailable} onClick={() => { if (!unavailable) void decide(id, "approve", note); }} className={buttonClass("approve", "md", buttonState)}>
          Approve
        </button>
        <button type="button" aria-disabled={unavailable} onClick={() => { if (!unavailable) void decide(id, "deny", note); }} className={buttonClass("deny", "md", buttonState)}>
          Decline
        </button>
      </div>
      {error && (
        <p className="text-sm text-stop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
