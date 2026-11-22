import type { ReactNode } from "react";
import Link from "next/link";
import type { LiveSummary } from "@/app/api/_lib/live-calls";
import { Badge, RowNav, TableEmpty, When, cn } from "@/components/ui";

const length = (c: LiveSummary) => {
  if (!c.endedAt) return "";
  const s = Math.max(0, Math.round((Date.parse(c.endedAt) - Date.parse(c.startedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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
                <When iso={c.startedAt} /> · {c.turns} caller turns {length(c) && `· ${length(c)}`}
              </span>
            </span>
            {c.state === "failed" ? (
              <span title={c.message}><Badge tone="stop">Call failed</Badge></span>
            ) : c.state !== "ended" ? (
              <Badge tone="accent" dot>On the line</Badge>
            ) : (
              <>
                <Badge tone="review">{`${c.caught} caught`}</Badge>
                <Badge tone={c.broken ? "stop" : "accent"} dot>{`${c.broken} broken`}</Badge>
                <span className={cn("text-xs", c.recordVerified ? "text-accent" : "text-stop")}>{c.recordVerified ? "record verified" : "record not verified"}</span>
              </>
            )}
            <span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </li>
      ))}
    </ul>
    </RowNav>
  );
}
