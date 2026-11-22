import type { ReactNode } from "react";
import Link from "next/link";
import type { LiveSummary } from "@/app/api/_lib/live-calls";
import { Badge, RowNav, TableEmpty, When, cn } from "@/components/ui";

const length = (c: LiveSummary) => {
  const end = c.endedAt ? Date.parse(c.endedAt) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(c.startedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function stateLabel(state: LiveSummary["state"]) {
  switch (String(state)) {
    case "ringing": return { label: "Connecting", tone: "quick" as const };
    case "connected": return { label: "Active", tone: "accent" as const };
    case "ended": return { label: "Completed", tone: "neutral" as const };
    case "failed": return { label: "Failed", tone: "stop" as const };
    case "queued": return { label: "Queued", tone: "quick" as const };
    case "cancelled":
    case "canceled": return { label: "Cancelled", tone: "neutral" as const };
    default: return { label: "Status unavailable", tone: "neutral" as const };
  }
}

const sourceLabel = (c: LiveSummary) => c.source.kind === "new" ? "One-off attack" : `${c.source.kind} · ${c.source.id}`;

/** Finished live calls, newest first, each with its verdict and a link to watch it again. */
export function RecentLiveCalls({ calls, empty, action }: { calls: LiveSummary[]; empty: string; action?: ReactNode }) {
  if (!calls.length) return <TableEmpty action={action}>{empty}</TableEmpty>;
  return (
    <RowNav>
    <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {calls.map((c) => (
        <li key={c.id} className="border-t border-line first:border-t-0">
          <Link data-row="" href={`/app/safety/calls/${c.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-sunken/60">
            <span aria-hidden className="text-ink-3">☎</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{c.title}</span>
              <span className="text-xs text-ink-3">
                Call <code className="break-all font-mono">{c.id}</code> · {sourceLabel(c)} · <When iso={c.startedAt} /> · {c.attacker === "gemini" ? "Gemini" : "Claude"} attacking · {c.turns} caller turns · {length(c)} elapsed
              </span>
            </span>
            <Badge tone="neutral">Synthetic test</Badge>
            <Badge tone={stateLabel(c.state).tone} dot>{stateLabel(c.state).label}</Badge>
            {c.state === "ended" || c.state === "failed" ? (
              <>
                <Badge tone="review">{c.state === "failed" ? `${c.caught} caught before failure` : `${c.caught} caught`}</Badge>
                <Badge tone={c.broken ? "stop" : "accent"} dot>{c.state === "failed" ? `${c.broken} broken so far` : `${c.broken} broken`}</Badge>
                <span className={cn("text-xs", c.recordVerified ? "text-accent" : "text-stop")}>{c.recordVerified ? "record verified" : "record not verified"}</span>
                {c.state === "failed" && c.message && <span title={c.message} className="text-xs text-stop">{c.message}</span>}
              </>
            ) : null}
            <span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </li>
      ))}
    </ul>
    </RowNav>
  );
}
