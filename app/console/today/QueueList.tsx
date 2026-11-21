"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToEvents } from "@/lib/events/client";

export type QueueRow = {
  id: string;
  lane: "automatic" | "quick_check" | "review";
  kind: string;
  initials: string;
  drug?: string;
  ruleIds: string[];
  signals: string[];
  notes: string[];
};

const LANE_LABEL = { review: "Review", quick_check: "Quick check", automatic: "Automatic" } as const;

// Approve and Deny call POST /api/queue/:id/decide. The server takes the approver
// from the Auth0 session; nothing here says who is deciding.
export function QueueList({ rows, canDecide, signedIn }: { rows: QueueRow[]; canDecide: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Refresh when any queue item changes, from this page or anywhere else.
  useEffect(() => listenToEvents((event) => event.type === "queue" && router.refresh()), [router]);

  async function decide(id: string, decision: "approve" | "deny") {
    setBusy(id);
    setError("");
    const note = notes[id]?.trim();
    const res = await fetch(`/api/queue/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { decision, note } : { decision }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium">Waiting for a pharmacist</h2>
      {!signedIn && <p className="mt-1 text-sm text-neutral-500">Sign in as a pharmacist to approve or deny.</p>}
      {signedIn && !canDecide && <p className="mt-1 text-sm text-neutral-500">Only a pharmacist can approve or deny.</p>}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">Nothing waiting.</p>
      ) : (
        <ul className="mt-2 space-y-3" data-testid="queue">
          {rows.map((row) => (
            <li key={row.id} className="rounded border border-neutral-300 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">{LANE_LABEL[row.lane]}</span>
                <strong className="capitalize">{row.kind}</strong>
                {row.drug && <span>{row.drug}</span>}
                <span>for {row.initials}</span>
                {row.ruleIds.map((id) => (
                  <span key={id} className="rounded border border-neutral-400 px-1.5 text-xs">
                    Rule {id}
                  </span>
                ))}
              </div>
              {row.signals.length > 0 && <p className="mt-1 text-xs text-neutral-500">Signals: {row.signals.join(", ")}</p>}
              {row.notes.map((note, i) => (
                <p key={i} className="mt-1 text-sm">
                  {note}
                </p>
              ))}
              {canDecide && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Note for the record"
                    placeholder="Note (optional)"
                    value={notes[row.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="min-w-48 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => decide(row.id, "approve")}
                    className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => decide(row.id, "deny")}
                    className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
