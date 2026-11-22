"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listenToEvents } from "@/lib/events/client";
import { Badge, Card, LANE_LABEL, Table, TableEmpty, Td, Th, THead, Tr, cn, type Lane } from "@/components/ui";
import { LaneTotals } from "@/app/console/today/LaneTotals";
import { DecideBar } from "../_parts/Decide";
import { SlideOver } from "../_parts/SlideOver";
import { dateTime, time, typing } from "../_parts/format";
import { ItemPanel, ItemSummary } from "./ItemPanel";
import type { Today, TodayItem } from "./today";

type Filter = Lane | "all";
const FILTERS: Filter[] = ["all", "review", "quick_check", "automatic"];

function Row({ d, selected, onSelect }: { d: TodayItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-item={d.id}
        className={cn(
          "flex w-full items-center justify-between gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none",
          d.lane === "review" ? "border-l-review" : d.lane === "quick_check" ? "border-l-quick" : "border-l-accent",
          selected && "bg-sunken",
        )}
      >
        <ItemSummary d={d} />
        <span className="shrink-0 text-xs tabular-nums text-ink-3">{time(d.createdAt)}</span>
      </button>
    </li>
  );
}

/**
 * Today: Review first, then Quick check, then what went through on its own. Pick an item
 * to see why it's here and decide it. Keys: ↑/↓ or J/K move, A approve, D decline, N note.
 */
export function TodayBoard({ data, canDecide, initial }: { data: Today; canDecide: boolean; initial?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState("");
  const all = useMemo(() => [...data.waiting, ...data.automatic], [data]);
  const shown = useMemo(() => all.filter((d) => filter === "all" || d.lane === filter), [all, filter]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initial ?? data.waiting[0]?.id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const selected = all.find((d) => d.id === selectedId) ?? shown[0];

  const move = useCallback(
    (step: number) => {
      if (shown.length === 0) return;
      const at = Math.max(0, shown.findIndex((d) => d.id === selected?.id));
      const next = shown[Math.min(shown.length - 1, Math.max(0, at + step))];
      setSelectedId(next.id);
      document.querySelector<HTMLElement>(`[data-item="${next.id}"]`)?.focus();
    },
    [shown, selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || key === "j") return (e.preventDefault(), move(1));
      if (key === "arrowup" || key === "k") return (e.preventDefault(), move(-1));
      if (!canDecide || !selected || selected.status !== "open" || selected.lane === "automatic") return;
      const panel = document.querySelector("[data-decide-panel]");
      if (key === "a") panel?.querySelector<HTMLButtonElement>('[data-decide="approve"]')?.click();
      if (key === "d") panel?.querySelector<HTMLButtonElement>('[data-decide="deny"]')?.click();
      if (key === "n") {
        e.preventDefault();
        panel?.querySelector<HTMLInputElement>("[data-decide-note]")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, canDecide, selected]);

  // A toast when something new needs a pharmacist (the page itself refreshes through <Live>).
  useEffect(() => {
    const known = new Set(all.map((d) => d.id));
    return listenToEvents((event) => {
      if (event.type !== "queue" || known.has(event.item.id) || event.item.status !== "open" || event.item.lane === "automatic") return;
      known.add(event.item.id);
      setToast(`New in ${LANE_LABEL[event.item.lane]}: ${event.item.kind} from call ${event.item.callId}`);
    });
  }, [all]);
  useEffect(() => {
    if (!toast) return;
    const hide = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(hide);
  }, [toast]);

  const panel = selected && (
    <div data-decide-panel>
      <ItemPanel d={selected} />
      {canDecide && selected.status === "open" && selected.lane !== "automatic" && (
        <DecideBar key={selected.id} id={selected.id} hint className="mt-5 border-t border-line pt-4" />
      )}
      {selected.lane === "automatic" && <p className="mt-5 border-t border-line pt-4 text-sm text-ink-3">Went through on its own: no rule card matched and nothing unusual was seen.</p>}
    </div>
  );

  return (
    <>
      <LaneTotals totals={data.totals} />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Lane" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count = f === "all" ? all.length : all.filter((d) => d.lane === f).length;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "h-8 rounded-full border px-3.5 text-[13px] transition-colors",
                  filter === f ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
                )}
              >
                {f === "all" ? "Everything" : LANE_LABEL[f]} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <p className="hidden text-xs text-ink-3 md:block">
          <kbd className="font-mono">↑↓</kbd> move{canDecide && " · A approve · D decline · N note"}
        </p>
      </div>

      {!canDecide && <p className="mt-3 text-sm text-ink-3">Only a pharmacist can approve or decline. You can read everything.</p>}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          {shown.length === 0 ? (
            <TableEmpty>{filter === "all" ? "Nothing waiting. Run the daily check to ring today's patients." : `Nothing in ${LANE_LABEL[filter]}.`}</TableEmpty>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" data-testid="queue">
              {shown.map((d) => (
                <Row
                  key={d.id}
                  d={d}
                  selected={d.id === selected?.id}
                  onSelect={() => {
                    setSelectedId(d.id);
                    setMobileOpen(true);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        <Card className="hidden self-start lg:sticky lg:top-6 lg:block" aria-label="Selected item">
          {panel ?? <p className="text-sm text-ink-3">Pick an item to see why it&apos;s here.</p>}
        </Card>
      </div>

      <div className="lg:hidden">
        <SlideOver open={mobileOpen && Boolean(selected)} onClose={() => setMobileOpen(false)} title="Queue item">
          {panel}
        </SlideOver>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Decided</h2>
        <div className="mt-3">
          {data.decided.length === 0 ? (
            <TableEmpty>No decisions yet.</TableEmpty>
          ) : (
            <Table data-testid="decided">
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Item</Th>
                  <Th>Decision</Th>
                  <Th>Note</Th>
                  <Th />
                </tr>
              </THead>
              <tbody>
                {data.decided.map((d) => (
                  <Tr key={d.id}>
                    <Td className="whitespace-nowrap">{dateTime(d.decidedAt)}</Td>
                    <Td>
                      <ItemSummary d={d} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={d.status === "approved" ? "accent" : "stop"} dot>
                        {d.status === "approved" ? "Approved" : "Declined"}
                      </Badge>{" "}
                      <span className="text-ink-3">by {d.decidedBy ?? "unknown"}</span>
                    </Td>
                    <Td>{d.decisionNote ?? <span className="text-ink-3">–</span>}</Td>
                    <Td className="text-right">
                      <Link href={`/app/pharmacy/calls/${encodeURIComponent(d.callId)}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">
                        Call
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </section>

      <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
        {toast && <div className="pointer-events-auto rounded-full bg-ink px-4 py-2 text-sm text-ink-inverse shadow-card">{toast}</div>}
      </div>
    </>
  );
}
