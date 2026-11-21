"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToEvents } from "@/lib/events/client";
import type { ItemDetail, LaneTotals as Totals } from "./detail";
import { LaneTotals } from "./LaneTotals";
import { Badge, LaneBadge, buttonClass } from "@/components/ui";

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
  return <span className="inline-flex items-center rounded-md border border-line-strong bg-surface px-1.5 font-mono text-[11px] leading-5 text-ink-2">Rule {id}</span>;
}

function Detail({ d }: { d: ItemDetail }) {
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4 text-sm text-ink-2">
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">Why it&apos;s here</h4>
        {d.rules.length === 0 && <p className="text-ink-3">No rule card: sent here by the signals below.</p>}
        <ul className="mt-1 space-y-1">
          {d.rules.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <RuleChip id={r.id} /> <span>{r.wording}</span>
            </li>
          ))}
        </ul>
      </div>
      {d.sideEffects.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">Side effects the patient reported</h4>
          <ul className="mt-1 list-disc pl-5">
            {d.sideEffects.map((s) => (
              <li key={s}>&ldquo;{s}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
      {d.questions.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">Questions for the pharmacist</h4>
          <ul className="mt-1 list-disc pl-5">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">What the patient was told</h4>
        {d.told.length === 0 && <p className="text-ink-3">Nothing yet.</p>}
        <ul className="mt-1 space-y-1">
          {d.told.map((t, i) =>
            t.blocked ? (
              <li key={i}>
                <span className="text-stop line-through decoration-stop">{t.text}</span>{" "}
                <span className="rounded-full bg-stop-soft px-2 py-0.5 text-xs font-medium text-stop">blocked by {t.rule}</span>
                <span className="mt-0.5 block text-ink-3">Said instead: {t.replacement}</span>
              </li>
            ) : (
              <li key={i}>
                <span className="text-ink">{t.text}</span> <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">checked</span>
              </li>
            ),
          )}
        </ul>
      </div>
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">Signals checked in code</h4>
        {d.signals.length === 0 ? (
          <p className="text-ink-3">None.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {d.signals.map((s) => (
              <li key={s}>{SIGNAL_LABEL[s] ?? s}</li>
            ))}
          </ul>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-[13px] font-medium text-ink hover:text-accent">Transcript ({d.transcript.length} lines)</summary>
        <ol className="mt-2 space-y-1 rounded-xl bg-sunken p-3">
          {d.transcript.map((l, i) => (
            <li key={i}>
              <span className="text-ink-3">{l.who === "agent" ? "Agent" : "Caller"}:</span>{" "}
              {l.blocked ? (
                <>
                  <span className="line-through">{l.text}</span> <span className="text-xs text-stop">({l.blocked})</span>
                </>
              ) : (
                l.text
              )}
            </li>
          ))}
        </ol>
      </details>
      {d.aiView && (
        <div className="rounded-xl border border-dashed border-line-strong p-3">
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">The agent&apos;s own view</h4>
          <p className="text-xs text-ink-3">Self-reported by the AI. Shown for context, never used for decisions.</p>
          <p className="mt-1">{d.aiView}</p>
        </div>
      )}
    </div>
  );
}

function Summary({ d }: { d: ItemDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <LaneBadge lane={d.lane} />
      <strong className="font-semibold capitalize text-ink">{d.kind}</strong>
      {d.drug && <span className="text-ink">{d.drug}</span>}
      <span className="text-ink-3">for {d.patient}</span>
      {d.rules.map((r) => (
        <RuleChip key={r.id} id={r.id} />
      ))}
      {d.sideEffects.length > 0 && <Badge tone="quick">side effect</Badge>}
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
  totals: Totals;
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

  const review = waiting.filter((d) => d.lane === "review");
  const quick = waiting.filter((d) => d.lane === "quick_check");

  // A plain function, not a component: a component defined here would remount on every
  // render and the note box would lose focus on each keystroke.
  function decideControls(id: string, compact = false) {
    return (
      <div className={compact ? "flex items-center gap-2" : "mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"}>
        {!compact && (
          <input
            aria-label="Note for the record"
            placeholder="Note (optional), e.g. chat at pickup"
            value={notes[id] ?? ""}
            onChange={(e) => setNotes((prev) => ({ ...prev, [id]: e.target.value }))}
            className="h-9 min-w-48 flex-1 rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        )}
        <button
          type="button"
          disabled={busy === id}
          onClick={() => decide(id, "approve")}
          className={buttonClass("approve", "sm")}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy === id}
          onClick={() => decide(id, "deny")}
          className={buttonClass("deny", "sm")}
        >
          Deny
        </button>
      </div>
    );
  }

  return (
    <>
      <LaneTotals totals={totals} />

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Waiting for a pharmacist</h2>
        {!signedIn && <p className="mt-1 text-sm text-ink-3">Sign in as a pharmacist to approve or deny.</p>}
        {signedIn && !canDecide && <p className="mt-1 text-sm text-ink-3">Only a pharmacist can approve or deny.</p>}
        {error && (
          <p className="mt-2 text-sm text-stop" role="alert">
            {error}
          </p>
        )}
        {waiting.length === 0 && <p className="mt-3 rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">Nothing waiting.</p>}
      </section>

      {review.length > 0 && (
        <section className="mt-6" data-testid="review">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className="size-2 rounded-full bg-review" />Review ({review.length})</h3>
          <ul className="mt-3 space-y-3" data-testid="queue">
            {review.map((d, i) => (
              <li key={d.id} className="rounded-card border border-line border-l-4 border-l-review bg-surface p-4 shadow-card">
                <details open={i === 0}>
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <Summary d={d} />
                  </summary>
                  <Detail d={d} />
                </details>
                {canDecide && decideControls(d.id)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {quick.length > 0 && (
        <section className="mt-8" data-testid="quick-check">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className="size-2 rounded-full bg-quick" />Quick check ({quick.length})</h3>
          <p className="mt-1 text-xs text-ink-3">Policy-only items with nothing unusual. One tap each; every approval is signed with your sign-in.</p>
          <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface shadow-card">
            {quick.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <details>
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <Summary d={d} />
                    </summary>
                    <Detail d={d} />
                  </details>
                  {canDecide && decideControls(d.id, true)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decided.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Decided</h2>
          <ul className="mt-2 space-y-2" data-testid="decided">
            {decided.map((d) => (
              <li key={d.id} className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <Summary d={d} />{" "}
                <span className={d.status === "approved" ? "font-medium text-accent" : "font-medium text-stop"}>
                  {d.status} by {d.decidedBy ?? "unknown"}
                </span>
                {d.decisionNote && <span className="text-ink-3"> · {d.decisionNote}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
