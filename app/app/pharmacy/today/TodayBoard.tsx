"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listenToEvents } from "@/lib/events/client";
import { Badge, Card, LANE_LABEL, SectionHeader, Table, TableEmpty, Td, Th, THead, Tr, When, chipClass, cn, linkClass, type Lane } from "@/components/ui";
import { DecideBar } from "../_parts/Decide";
import { SlideOver } from "../_parts/SlideOver";
import { typing } from "../_parts/format";
import { ItemPanel, ItemSummary } from "./ItemPanel";
import { HistoryNote } from "../_parts/HistoryNote";

/** The approver the scripted demo week decides as (app/api/_lib/demo-history.ts HISTORY_APPROVER). */
const HISTORY_APPROVER_NAME = "Scripted demo pharmacist";
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
          "flex w-full items-center justify-between gap-3 border-l-2 px-4 py-3 text-left transition-colors hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none",
          selected ? "border-l-accent bg-sunken" : "border-l-transparent",
        )}
      >
        <ItemSummary d={d} />
        <When iso={d.createdAt} className="shrink-0 text-xs text-ink-3" />
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
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Lane" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count = f === "all" ? all.length : all.filter((d) => d.lane === f).length;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={chipClass(filter === f)}
              >
                {f !== "all" && <span aria-hidden className={cn("size-1.5 rounded-full", f === "review" ? "bg-review" : f === "quick_check" ? "bg-quick" : "bg-auto")} />}
                {f === "all" ? "Everything" : LANE_LABEL[f]} <span className="tabular-nums text-ink-3">{count}</span>
              </button>
            );
          })}
        </div>
        <p className="hidden text-xs text-ink-3 md:block">
          <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">↑↓</kbd> move
          {canDecide && (
            <>
              {" · "}
              <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">A</kbd> approve ·{" "}
              <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">D</kbd> decline ·{" "}
              <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">N</kbd> note
            </>
          )}
        </p>
      </div>

      {!canDecide && <p className="mt-3 text-sm text-ink-3">Only a pharmacist can approve or decline. You can read everything.</p>}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          {shown.length === 0 ? (
            <TableEmpty>{filter === "all" ? "Nothing waiting. The herd's all set." : `Nothing in ${LANE_LABEL[filter]}.`}</TableEmpty>
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
          {panel ?? <p className="text-[13px] text-ink-3">{all.length ? "Pick an item to see why it's here." : "When a call needs a pharmacist, the reason and the transcript show here."}</p>}
        </Card>
      </div>

      <div className="lg:hidden">
        <SlideOver open={mobileOpen && Boolean(selected)} onClose={() => setMobileOpen(false)} title="Queue item">
          {panel}
        </SlideOver>
      </div>

      {data.appointments.length > 0 && (
        <section className="mt-10">
          <SectionHeader title="Upcoming pharmacist appointments" />
          <Table>
            <THead><tr><Th>Appointment</Th><Th>Patient</Th></tr></THead>
            <tbody>
              {data.appointments.map((booking) => (
                <Tr key={booking.slotId}><Td>{booking.label}</Td><Td>{booking.patient}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section className="mt-10">
        <SectionHeader
          title="Decided"
          description={
            <>
              Approvals and declines, newest first, with the note that went to the record.
              <span className="mt-1.5 block">
                <HistoryNote count={data.decided.filter((d) => d.decidedBy === HISTORY_APPROVER_NAME).length} />
              </span>
            </>
          }
        />
        <div>
          {data.decided.length === 0 ? (
            <TableEmpty>No decisions yet today.</TableEmpty>
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
                    <Td className="whitespace-nowrap">
                      <When iso={d.decidedAt} />
                    </Td>
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
                      <Link href={`/app/pharmacy/calls/${encodeURIComponent(d.callId)}`} className={linkClass}>
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
        {toast && <div className="pointer-events-auto rounded-full border border-line-strong bg-raised px-4 py-2 text-sm text-ink shadow-pop">{toast}</div>}
      </div>
    </>
  );
}
