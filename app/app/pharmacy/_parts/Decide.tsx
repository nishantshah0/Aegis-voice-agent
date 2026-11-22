"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, cn } from "@/components/ui";

export type Decision = "approve" | "deny";

/**
 * Approve or decline one queue item through POST /api/queue/:id/decide. The server takes
 * the approver from the Auth0 session and checks the role; nothing here says who decides.
 */
export function useDecide() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function decide(id: string, decision: Decision, note?: string) {
    setBusy(id);
    setError("");
    const text = note?.trim();
    const res = await fetch(`/api/queue/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(text ? { decision, note: text } : { decision }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error ?? `Failed (${res?.status ?? "network"})`);
      return false;
    }
    router.refresh();
    return true;
  }
  return { decide, busy, error };
}

/** The note box and the two buttons, for one item. */
export function DecideBar({ id, className, hint }: { id: string; className?: string; hint?: boolean }) {
  const { decide, busy, error } = useDecide();
  const [note, setNote] = useState("");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Note for the record"
          placeholder="Note (optional), e.g. chat at pickup"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-decide-note={id}
          className="h-9 min-w-48 flex-1 rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <button type="button" disabled={busy === id} onClick={() => decide(id, "approve", note)} className={buttonClass("approve", "sm")} data-decide="approve">
          Approve{hint && <kbd className="ml-1 rounded bg-ink-inverse/20 px-1 font-mono text-[10px]">A</kbd>}
        </button>
        <button type="button" disabled={busy === id} onClick={() => decide(id, "deny", note)} className={buttonClass("deny", "sm")} data-decide="deny">
          Decline{hint && <kbd className="ml-1 rounded bg-sunken px-1 font-mono text-[10px]">D</kbd>}
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
