"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Card, TableEmpty, cn } from "@/components/ui";
import { typing } from "../_parts/format";

export type ReviewStatus = "unlabelled" | "labelled" | "test";
export type ReviewListItem = { callId: string; patient: string; direction: string; endedAt?: string; status: ReviewStatus; blocked: number; lines: number };

const FILTERS: { key: ReviewStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unlabelled", label: "Not labelled" },
  { key: "labelled", label: "Labelled" },
  { key: "test", label: "Saved as tests" },
];
const STATUS_BADGE: Record<ReviewStatus, ReactNode> = {
  unlabelled: <Badge tone="review">to label</Badge>,
  labelled: <Badge tone="accent">labelled</Badge>,
  test: <Badge tone="quick">test</Badge>,
};

/** Finished calls on the left, the chosen one on the right. ↑/↓ or J/K move between calls. */
export function ReviewBoard({ calls, cards }: { calls: ReviewListItem[]; cards: Record<string, ReactNode> }) {
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((c) => (filter === "all" || c.status === filter) && (!q || `${c.callId} ${c.patient}`.toLowerCase().includes(q)));
  }, [calls, filter, query]);
  const [selectedId, setSelectedId] = useState(calls.find((c) => c.status === "unlabelled")?.callId ?? calls[0]?.callId);
  const selected = shown.find((c) => c.callId === selectedId) ?? shown[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!step || shown.length === 0) return;
      e.preventDefault();
      const at = Math.max(0, shown.findIndex((c) => c.callId === selected?.callId));
      const next = shown[Math.min(shown.length - 1, Math.max(0, at + step))];
      setSelectedId(next.callId);
      document.querySelector<HTMLElement>(`[data-review="${next.callId}"]`)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected]);

  if (calls.length === 0) return <TableEmpty>No finished calls yet. A call shows up here once it ends.</TableEmpty>;

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search call or initials"
          aria-label="Search finished calls"
          className="h-9 rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn("h-7 rounded-full border px-3 text-xs", filter === f.key ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3")}
            >
              {f.label} <span className="opacity-60">{f.key === "all" ? calls.length : calls.filter((c) => c.status === f.key).length}</span>
            </button>
          ))}
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {shown.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">No calls match.</li>}
          {shown.map((c) => (
            <li key={c.callId}>
              <button
                type="button"
                data-review={c.callId}
                aria-current={c.callId === selected?.callId ? "true" : undefined}
                onClick={() => setSelectedId(c.callId)}
                className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none", c.callId === selected?.callId && "bg-sunken")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink">{c.callId}</span>
                  {STATUS_BADGE[c.status]}
                </span>
                <span className="text-xs text-ink-3">
                  {c.patient} · {c.direction} · {c.lines} lines{c.blocked > 0 && <span className="text-stop"> · {c.blocked} blocked</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Card>{selected ? cards[selected.callId] : <p className="text-sm text-ink-3">Pick a call.</p>}</Card>
    </div>
  );
}
