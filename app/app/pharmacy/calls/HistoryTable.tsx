"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  LANE_LABEL,
  LaneBadge,
  Table,
  TableEmpty,
  Td,
  Th,
  THead,
  Tr,
  When,
  chipClass,
  inputClass,
  type Lane,
} from "@/components/ui";
import { label, typing } from "../_parts/format";
import { ScriptedTag } from "../_parts/HistoryNote";
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  filterRows,
  type HistoryFilter,
  type HistoryRow,
} from "./rows";

const LANES: HistoryFilter["lane"][] = [
  "all",
  "review",
  "quick_check",
  "automatic",
  "none",
];
const OUTCOMES: HistoryFilter["outcome"][] = [
  "all",
  "waiting",
  "approved",
  "denied",
  "automatic",
  "refused",
  "nothing",
];
const href = (id: string, filter: HistoryFilter) => {
  const params = new URLSearchParams();
  if (filter.query.trim()) params.set("q", filter.query.trim());
  if (filter.lane !== "all") params.set("lane", filter.lane);
  if (filter.outcome !== "all") params.set("outcome", filter.outcome);
  const query = params.toString();
  return `/app/pharmacy/calls/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
};

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={chipClass(on, "h-7 px-2.5 text-xs")}
    >
      {children}
    </button>
  );
}

/** The first lines of a call, shown when a row is hovered or focused. */
function Peek({
  row,
  top,
  left,
}: {
  row: HistoryRow;
  top: number;
  left: number;
}) {
  return (
    <div
      role="tooltip"
      style={{ top, left }}
      className="pointer-events-none fixed z-30 w-96 max-w-[80vw] rounded-lg border border-line-strong bg-raised p-3 text-left text-xs shadow-pop"
    >
      {row.preview.length === 0 ? (
        <p className="text-ink-3">Nothing said yet.</p>
      ) : (
        <ol className="space-y-1">
          {row.preview.map((l, i) => (
            <li key={i}>
              <span className="text-ink-3">
                {l.who === "agent" ? "Agent" : "Caller"}:
              </span>{" "}
              {l.blocked ? (
                <s className="text-stop">{l.text}</s>
              ) : (
                <span className="text-ink-2">{l.text}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {row.lines > row.preview.length && (
        <p className="mt-1 text-ink-3">
          … {row.lines - row.preview.length} more lines
        </p>
      )}
    </div>
  );
}

/** Every call. "/" searches, ↑/↓ or J/K move, Enter opens. */
export function HistoryTable({ rows, scripted = [], initialFilter }: { rows: HistoryRow[]; scripted?: string[]; initialFilter?: HistoryFilter }) {
  const isScripted = useMemo(() => new Set(scripted), [scripted]);
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter ?? { query: "", lane: "all", outcome: "all" });
  const [active, setActive] = useState(0);
  const [peek, setPeek] = useState<{
    row: HistoryRow;
    top: number;
    left: number;
  } | null>(null);
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
      if (e.key === "/" && !typing(e.target))
        return (e.preventDefault(), search.current?.focus());
      if (typing(e.target) && e.key !== "ArrowDown" && e.key !== "Enter")
        return;
      const step =
        e.key === "ArrowDown" || e.key === "j"
          ? 1
          : e.key === "ArrowUp" || e.key === "k"
            ? -1
            : 0;
      if (step) {
        e.preventDefault();
        const next = Math.min(shown.length - 1, Math.max(0, active + step));
        setActive(next);
        document.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
      }
      if (e.key === "Enter" && typing(e.target) && shown[active])
        router.push(href(shown[active].callId, filter));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, active, router, filter]);

  const activeFilters = [
    filter.query.trim() ? `Search “${filter.query.trim()}”` : "",
    filter.lane !== "all" ? `Routing: ${filter.lane === "none" ? "No request" : LANE_LABEL[filter.lane]}` : "",
    filter.outcome !== "all" ? `Outcome: ${OUTCOME_LABEL[filter.outcome]}` : "",
  ].filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex w-full max-w-xl min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-medium text-ink">Search</span>
            <input
              ref={search}
              type="search"
              value={filter.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Name, call ID, or words said"
              aria-label="Search calls"
              className={inputClass("h-10 min-w-0 flex-1 border-ink-3 bg-surface shadow-card focus:ring-2 focus:ring-accent/20")}
            />
          </label>
          <span className="text-xs text-ink-3" aria-live="polite">
            {shown.length} matching {shown.length === 1 ? "call" : "calls"} · {rows.length} total
          </span>
        </div>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3" aria-label="Active filters">
            <span>Filtered by {activeFilters.join(" · ")}</span>
            <button type="button" className="font-medium text-accent underline-offset-4 hover:underline" onClick={() => set({ query: "", lane: "all", outcome: "all" })}>
              Clear filters
            </button>
          </div>
        )}
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Filter by routing"
        >
          <span className="mr-1 w-16 text-xs font-medium text-ink-3">Routing</span>
          {LANES.map((l) => (
            <Chip
              key={l}
              on={filter.lane === l}
              onClick={() => set({ lane: l })}
            >
              {l === "all"
                ? "Any"
                : l === "none"
                  ? "No request"
                  : LANE_LABEL[l as Lane]}
            </Chip>
          ))}
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Filter by outcome"
        >
          <span className="mr-1 w-16 text-xs font-medium text-ink-3">
            Outcome
          </span>
          {OUTCOMES.map((o) => (
            <Chip
              key={o}
              on={filter.outcome === o}
              onClick={() => set({ outcome: o })}
            >
              {o === "all" ? "Any" : OUTCOME_LABEL[o]}{" "}
              <span className="tabular-nums text-ink-3">
                {o === "all"
                  ? rows.length
                  : rows.filter((r) => r.outcome === o).length}
              </span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {shown.length === 0 ? (
          <TableEmpty>
            {rows.length === 0
              ? "No calls yet. Run the daily check from the Demo menu, or call in from the phone."
              : "No calls match these filters."}
          </TableEmpty>
        ) : (
          <Table data-testid="history-table">
            <THead>
              <tr>
                <Th>Call</Th>
                <Th>Patient</Th>
                <Th>Started</Th>
                <Th>Source</Th>
                <Th>State</Th>
                <Th>Lanes</Th>
                <Th>Outcome</Th>
                <Th numeric>Presses</Th>
                <Th numeric>Blocked</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r, i) => (
                <Tr
                  key={r.callId}
                  data-row={i}
                  tabIndex={0}
                  onClick={() => router.push(href(r.callId, filter))}
                  onFocus={(e) => (setActive(i), showPeek(r, e.currentTarget))}
                  onBlur={() => setPeek(null)}
                  onMouseEnter={(e) => showPeek(r, e.currentTarget)}
                  onMouseLeave={() => setPeek(null)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && router.push(href(r.callId, filter))
                  }
                  aria-selected={i === active}
                  aria-label={`Call ${r.callId}${r.patient ? ` with ${r.patient}` : ""}: open`}
                >
                  <Td className="whitespace-nowrap font-mono text-xs text-ink">
                    {r.callId} {isScripted.has(r.callId) && <ScriptedTag className="ml-1 font-sans" />}
                  </Td>
                  <Td className="font-medium text-ink">
                    {r.patient ?? <span className="text-ink-3">unknown</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <When iso={r.startedAt} />{" "}
                    <span className="text-ink-3">· {r.direction}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-3">
                    {isScripted.has(r.callId) ? <ScriptedTag /> : "Call record"}
                  </Td>
                  <Td>
                    <Badge
                      tone={r.state === "ended" ? "neutral" : "accent"}
                      dot={r.state !== "ended"}
                    >
                      {label(r.state)}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {r.lanes.length === 0 ? (
                        <span className="text-ink-3">–</span>
                      ) : (
                        r.lanes.map((l) => <LaneBadge key={l} lane={l} />)
                      )}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={OUTCOME_TONE[r.outcome]}>
                      {OUTCOME_LABEL[r.outcome]}
                    </Badge>
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {r.presses.allowed +
                      r.presses.routed +
                      r.presses.refused +
                      r.presses.flagged}
                    {r.presses.refused > 0 && (
                      <span className="text-stop">
                        {" "}
                        · {r.presses.refused} refused
                      </span>
                    )}
                  </Td>
                  <Td numeric>
                    {r.blocked > 0 ? (
                      <Badge tone="stop">{r.blocked}</Badge>
                    ) : (
                      <span className="text-ink-3">0</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {peek && <Peek {...peek} />}
      <p className="mt-3 hidden text-xs text-ink-3 md:block">
        <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">
          /
        </kbd>{" "}
        search ·{" "}
        <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">
          ↑↓
        </kbd>{" "}
        move ·{" "}
        <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">
          Enter
        </kbd>{" "}
        open · hover a call to peek
      </p>
    </>
  );
}
