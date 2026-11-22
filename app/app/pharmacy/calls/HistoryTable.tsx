"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, LANE_LABEL, LaneBadge, Table, TableEmpty, Td, Th, THead, Tr, cn, type Lane } from "@/components/ui";
import { dateTime, label, typing } from "../_parts/format";
import { OUTCOME_LABEL, OUTCOME_TONE, filterRows, type HistoryFilter, type HistoryRow } from "./rows";

const LANES: HistoryFilter["lane"][] = ["all", "review", "quick_check", "automatic", "none"];
const OUTCOMES: HistoryFilter["outcome"][] = ["all", "waiting", "approved", "denied", "automatic", "refused", "nothing"];
const href = (id: string) => `/app/pharmacy/calls/${encodeURIComponent(id)}`;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-7 rounded-full border px-3 text-xs transition-colors", on ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3")}
    >
      {children}
    </button>
  );
}

/** The first lines of a call, shown when a row is hovered or focused. */
function Peek({ row, top, left }: { row: HistoryRow; top: number; left: number }) {
  return (
    <div
      role="tooltip"
      style={{ top, left }}
      className="pointer-events-none fixed z-30 w-96 max-w-[80vw] rounded-card border border-line bg-surface p-3 text-left text-xs shadow-card"
    >
      {row.preview.length === 0 ? (
        <p className="text-ink-3">Nothing said yet.</p>
      ) : (
        <ol className="space-y-1">
          {row.preview.map((l, i) => (
            <li key={i}>
              <span className="text-ink-3">{l.who === "agent" ? "Agent" : "Caller"}:</span> {l.blocked ? <s className="text-stop">{l.text}</s> : <span className="text-ink-2">{l.text}</span>}
            </li>
          ))}
        </ol>
      )}
      {row.lines > row.preview.length && <p className="mt-1 text-ink-3">… {row.lines - row.preview.length} more lines</p>}
    </div>
  );
}

/** Every call. "/" searches, ↑/↓ or J/K move, Enter opens. */
export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<HistoryFilter>({ query: "", lane: "all", outcome: "all" });
  const [active, setActive] = useState(0);
  const [peek, setPeek] = useState<{ row: HistoryRow; top: number; left: number } | null>(null);
  const showPeek = (row: HistoryRow, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPeek({ row, top: r.bottom + 4, left: r.left + 16 });
  };
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const set = (patch: Partial<HistoryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setActive(0);
  };

  useEffect(() => {
    const hide = () => setPeek(null);
    window.addEventListener("scroll", hide, { passive: true });
    return () => window.removeEventListener("scroll", hide);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !typing(e.target)) return (e.preventDefault(), search.current?.focus());
      if (typing(e.target) && e.key !== "ArrowDown" && e.key !== "Enter") return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (step) {
        e.preventDefault();
        const next = Math.min(shown.length - 1, Math.max(0, active + step));
        setActive(next);
        document.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
      }
      if (e.key === "Enter" && typing(e.target) && shown[active]) router.push(href(shown[active].callId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, active, router]);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={search}
            type="search"
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search calls, initials or words said   /"
            aria-label="Search calls"
            className="h-9 w-80 max-w-full rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <span className="text-xs text-ink-3" aria-live="polite">
            {shown.length} of {rows.length} calls
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by lane">
          <span className="mr-1 w-16 text-xs text-ink-3">Lane</span>
          {LANES.map((l) => (
            <Chip key={l} on={filter.lane === l} onClick={() => set({ lane: l })}>
              {l === "all" ? "Any" : l === "none" ? "No request" : LANE_LABEL[l as Lane]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by outcome">
          <span className="mr-1 w-16 text-xs text-ink-3">Outcome</span>
          {OUTCOMES.map((o) => (
            <Chip key={o} on={filter.outcome === o} onClick={() => set({ outcome: o })}>
              {o === "all" ? "Any" : OUTCOME_LABEL[o]} <span className="opacity-60">{o === "all" ? rows.length : rows.filter((r) => r.outcome === o).length}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {shown.length === 0 ? (
          <TableEmpty>{rows.length === 0 ? "No calls yet. Run the daily check or call in from the phone." : "No calls match."}</TableEmpty>
        ) : (
          <Table data-testid="history-table">
            <THead>
              <tr>
                <Th>Call</Th>
                <Th>Patient</Th>
                <Th>Started</Th>
                <Th>State</Th>
                <Th>Lanes</Th>
                <Th>Outcome</Th>
                <Th>Presses</Th>
                <Th>Blocked</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r, i) => (
                <Tr
                  key={r.callId}
                  data-row={i}
                  tabIndex={0}
                  onClick={() => router.push(href(r.callId))}
                  onFocus={(e) => (setActive(i), showPeek(r, e.currentTarget))}
                  onBlur={() => setPeek(null)}
                  onMouseEnter={(e) => showPeek(r, e.currentTarget)}
                  onMouseLeave={() => setPeek(null)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(href(r.callId))}
                  className={cn("cursor-pointer focus-visible:bg-sunken focus-visible:outline-none", i === active && "bg-sunken/40")}
                  aria-label={`Call ${r.callId}${r.patient ? ` with ${r.patient}` : ""}: open`}
                >
                  <Td className="font-mono text-xs text-ink">{r.callId}</Td>
                  <Td className="font-medium text-ink">{r.patient ?? <span className="text-ink-3">unknown</span>}</Td>
                  <Td className="whitespace-nowrap">
                    {dateTime(r.startedAt)} <span className="text-ink-3">· {r.direction}</span>
                  </Td>
                  <Td>
                    <Badge tone={r.state === "ended" ? "neutral" : "accent"} dot={r.state !== "ended"}>
                      {label(r.state)}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {r.lanes.length === 0 ? <span className="text-ink-3">–</span> : r.lanes.map((l) => <LaneBadge key={l} lane={l} />)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.presses.allowed + r.presses.routed + r.presses.refused + r.presses.flagged}
                    {r.presses.refused > 0 && <span className="text-stop"> · {r.presses.refused} refused</span>}
                  </Td>
                  <Td>{r.blocked > 0 ? <Badge tone="stop">{r.blocked}</Badge> : <span className="text-ink-3">0</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {peek && <Peek {...peek} />}
      <p className="mt-3 hidden text-xs text-ink-3 md:block">
        <kbd className="font-mono">/</kbd> search · <kbd className="font-mono">↑↓</kbd> move · <kbd className="font-mono">Enter</kbd> open · hover a call to peek
      </p>
    </>
  );
}
