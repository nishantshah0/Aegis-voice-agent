"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToEvents } from "@/lib/events/client";
import type { ItemDetail, LaneTotals } from "./detail";

const LANE_LABEL = { review: "Review", quick_check: "Quick check", automatic: "Automatic" } as const;
const LANE_STYLE = {
  review: "bg-amber-200 text-amber-900",
  quick_check: "bg-amber-100 text-amber-900",
  automatic: "bg-green-200 text-green-900",
} as const;
const SIGNAL_LABEL: Record<string, string> = {
  early: "Early refill",
  new_address: "New address",
  side_effect: "Side effect reported",
  missed_doses: "Possible missed doses",
  failed_code_attempts: "Failed code attempts",
  speech_guard_replacement: "A line was blocked by the speech guard",
  safety_words: "Safety words",
  attack_alarm: "Attack alarm",
};

function RuleChip({ id }: { id: string }) {
  return <span className="rounded border border-neutral-400 px-1.5 text-xs">Rule {id}</span>;
}

function Detail({ d }: { d: ItemDetail }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div>
        <h4 className="font-medium">Why it&apos;s here</h4>
        {d.rules.length === 0 && <p className="text-neutral-500">No rule card: sent here by the signals below.</p>}
        <ul className="mt-1 space-y-1">
          {d.rules.map((r) => (
            <li key={r.id} className="flex gap-2">
              <RuleChip id={r.id} /> <span>{r.wording}</span>
            </li>
          ))}
        </ul>
      </div>
      {d.sideEffects.length > 0 && (
        <div>
          <h4 className="font-medium">Side effects the patient reported</h4>
          <ul className="mt-1 list-disc pl-5">
            {d.sideEffects.map((s) => (
              <li key={s}>&ldquo;{s}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
      {d.questions.length > 0 && (
        <div>
          <h4 className="font-medium">Questions for the pharmacist</h4>
          <ul className="mt-1 list-disc pl-5">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="font-medium">What the patient was told</h4>
        {d.told.length === 0 && <p className="text-neutral-500">Nothing yet.</p>}
        <ul className="mt-1 space-y-1">
          {d.told.map((t, i) =>
            t.blocked ? (
              <li key={i}>
                <span className="text-red-700 line-through">{t.text}</span>{" "}
                <span className="rounded bg-red-200 px-1.5 text-xs text-red-900">blocked by {t.rule}</span>
                <span className="block text-neutral-500">Said instead: {t.replacement}</span>
              </li>
            ) : (
              <li key={i}>
                {t.text} <span className="rounded bg-green-200 px-1.5 text-xs text-green-900">checked</span>
              </li>
            ),
          )}
        </ul>
      </div>
      <div>
        <h4 className="font-medium">Signals checked in code</h4>
        {d.signals.length === 0 ? (
          <p className="text-neutral-500">None.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {d.signals.map((s) => (
              <li key={s}>{SIGNAL_LABEL[s] ?? s}</li>
            ))}
          </ul>
        )}
      </div>
      <details>
        <summary className="cursor-pointer font-medium">Transcript ({d.transcript.length} lines)</summary>
        <ol className="mt-1 space-y-1">
          {d.transcript.map((l, i) => (
            <li key={i}>
              <span className="text-neutral-500">{l.who === "agent" ? "Agent" : "Caller"}:</span>{" "}
              {l.blocked ? (
                <>
                  <span className="line-through">{l.text}</span> <span className="text-xs text-red-700">({l.blocked})</span>
                </>
              ) : (
                l.text
              )}
            </li>
          ))}
        </ol>
      </details>
      {d.aiView && (
        <div className="rounded border border-dashed border-neutral-400 p-2">
          <h4 className="font-medium">The agent&apos;s own view</h4>
          <p className="text-xs text-neutral-500">Self-reported by the AI. Shown for context, never used for decisions.</p>
          <p className="mt-1">{d.aiView}</p>
        </div>
      )}
    </div>
  );
}

function Summary({ d }: { d: ItemDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`rounded px-1.5 py-0.5 text-xs ${LANE_STYLE[d.lane]}`}>{LANE_LABEL[d.lane]}</span>
      <strong className="capitalize">{d.kind}</strong>
      {d.drug && <span>{d.drug}</span>}
      <span>for {d.patient}</span>
      {d.rules.map((r) => (
        <RuleChip key={r.id} id={r.id} />
      ))}
      {d.sideEffects.length > 0 && <span className="text-xs text-amber-800">side effect</span>}
    </span>
  );
}

// Approve and Deny call POST /api/queue/:id/decide. The server takes the approver
// from the Auth0 session; nothing here says who is deciding.
export function QueueList({
  totals,
  waiting,
  decided,
  canDecide,
  signedIn,
}: {
  totals: LaneTotals;
  waiting: ItemDetail[];
  decided: ItemDetail[];
  canDecide: boolean;
  signedIn: boolean;
}) {
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
    <>
      <section className="mt-6 grid grid-cols-3 gap-3" data-testid="lane-totals">
        {(["automatic", "quick_check", "review"] as const).map((lane) => (
          <div key={lane} className="rounded border border-neutral-300 p-3">
            <div className="text-xs text-neutral-500">{LANE_LABEL[lane]}</div>
            <div className="text-2xl font-semibold">{totals[lane]}</div>
          </div>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-medium">Waiting for a pharmacist</h2>
        {!signedIn && <p className="mt-1 text-sm text-neutral-500">Sign in as a pharmacist to approve or deny.</p>}
        {signedIn && !canDecide && <p className="mt-1 text-sm text-neutral-500">Only a pharmacist can approve or deny.</p>}
        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nothing waiting.</p>
        ) : (
          <ul className="mt-2 space-y-3" data-testid="queue">
            {waiting.map((d, i) => (
              <li key={d.id} className="rounded border border-neutral-300 p-3">
                <details open={i === 0}>
                  <summary className="cursor-pointer">
                    <Summary d={d} />
                  </summary>
                  <Detail d={d} />
                </details>
                {canDecide && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Note for the record"
                      placeholder="Note (optional), e.g. chat at pickup"
                      value={notes[d.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      className="min-w-48 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy === d.id}
                      onClick={() => decide(d.id, "approve")}
                      className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy === d.id}
                      onClick={() => decide(d.id, "deny")}
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

      {decided.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Decided</h2>
          <ul className="mt-2 space-y-2" data-testid="decided">
            {decided.map((d) => (
              <li key={d.id} className="rounded border border-neutral-200 p-2 text-sm">
                <Summary d={d} />{" "}
                <span className={d.status === "approved" ? "text-green-700" : "text-red-700"}>
                  {d.status} by {d.decidedBy ?? "unknown"}
                </span>
                {d.decisionNote && <span className="text-neutral-500"> · {d.decisionNote}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
