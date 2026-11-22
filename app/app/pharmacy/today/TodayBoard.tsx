"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { QueueItem } from "@/lib/contract";
import { Badge, Card, SectionHeader, Table, TableEmpty, Td, Th, THead, Tr, When, chipClass, cn, linkClass, type Lane } from "@/components/ui";
import { absoluteTime, ZONE } from "@/components/ui/time";
import { DecideBar } from "../_parts/Decide";
import { LiveStatus, useLiveUpdates } from "../_parts/Live";
import { ItemPanel, ItemSummary, routingReason, TODAY_LANE_LABEL } from "./ItemPanel";
import type { Today, TodayItem } from "./today";

const MOBILE = "(width < 64rem)";
const FILTERS = ["waiting", "review", "quick_check", "automatic"] as const;
type Filter = Lane | "waiting";

const FILTER_LABEL: Record<Filter, string> = { waiting: "Waiting", ...TODAY_LANE_LABEL };
const EMPTY: Record<Filter, string> = {
  waiting: "No items are waiting for a pharmacist.",
  review: "No items are waiting in Review.",
  quick_check: "No items are waiting in Check.",
  automatic: "There is no recent automatic activity.",
};
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const rowId = (id: string) => `today-item-${id}`;
const filterId = (filter: Filter) => `today-filter-${filter}`;
const historyDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ZONE });
const historyClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONE });

function HistoryTime({ iso }: { iso?: string }) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return <span className="text-ink-3">—</span>;
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className="block whitespace-nowrap leading-tight proportional-nums">
      <span className="block">{historyDate.format(date)}</span>
      <span className="mt-0.5 block text-xs text-ink-3">{historyClock.format(date)}</span>
    </time>
  );
}

function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(MOBILE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function inFilter(item: TodayItem, filter: Filter) {
  if (filter === "automatic") return item.lane === "automatic";
  return item.status === "open" && item.lane !== "automatic" && (filter === "waiting" || item.lane === filter);
}

function setQueueUrl(filter: Filter, item?: string, fromMobileRow = false) {
  const url = new URL(window.location.href);
  if (filter === "waiting") url.searchParams.delete("lane");
  else url.searchParams.set("lane", filter);
  if (item) url.searchParams.set("item", item);
  else url.searchParams.delete("item");
  if (fromMobileRow) window.history.pushState({ todayQueueItem: item }, "", url);
  else window.history.replaceState(null, "", url);
}

function moveRowFocus(event: KeyboardEvent<HTMLUListElement>) {
  if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = rows.findIndex((row) => row === event.target);
  if (index === -1) return;
  event.preventDefault();
  const next = index + (event.key === "ArrowDown" ? 1 : -1);
  rows[Math.max(0, Math.min(next, rows.length - 1))]?.focus();
}

function Row({ d, selected, onSelect }: { d: TodayItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        id={rowId(d.id)}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "block w-full border-l-4 px-4 py-3 text-left transition-colors hover:bg-sunken/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
          selected ? "border-l-accent bg-sunken" : "border-l-transparent",
        )}
      >
        <ItemSummary d={d} />
        <span className="mt-1.5 block text-sm text-ink-2">{routingReason(d)}</span>
        <span className="mt-1 block text-xs text-ink-3">
          {d.lane === "automatic" ? "Routed" : "Waiting since"} <When iso={d.createdAt} />
        </span>
      </button>
    </li>
  );
}

function Outcome({ item }: { item: TodayItem }) {
  return (
    <div className="space-y-2 text-sm">
      <Badge tone={item.status === "approved" ? "accent" : "stop"} dot>
        {item.status === "approved" ? "Approved" : "Declined"}
      </Badge>
      <p className="text-ink-2">
        {item.decidedBy ?? "Pharmacist"} · <When iso={item.decidedAt} format="short" />
      </p>
      <p className="whitespace-pre-wrap break-words text-ink-2">{item.decisionNote ?? "No note recorded."}</p>
    </div>
  );
}

export function TodayBoard({ data, canDecide }: { data: Today; canDecide: boolean }) {
  const params = useSearchParams();
  const itemId = params.get("item");
  const hasItem = itemId !== null;
  const lane = params.get("lane");
  const requestedFilter = FILTERS.find((filter) => filter === lane) ?? "waiting";
  const mobile = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(MOBILE).matches, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  const decisionRegion = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<string>(null);
  const [resolutions, setResolutions] = useState(() => new Map<string, QueueItem>());

  const record = [...data.waiting, ...data.automatic, ...data.decided, data.linked].find((d) => d?.id === itemId);
  const resolution = record && resolutions.get(record.id);
  const selected = record?.status === "open" && resolution?.createdAt === record.createdAt && resolution.decidedAt
    ? { ...record, status: resolution.status, decidedBy: resolution.decidedBy?.name, decidedAt: resolution.decidedAt, decisionNote: resolution.decisionNote }
    : record;
  const resolved = selected && selected.lane !== "automatic" && selected.status !== "open";
  const filter = selected?.lane === "automatic" ? "automatic"
    : selected && !resolved && !inFilter(selected, requestedFilter) ? "waiting"
    : requestedFilter;

  function receiveResolution(item: QueueItem) {
    if (item.status === "open") return;
    const region = decisionRegion.current;
    if (region?.dataset.item === item.id && region.contains(document.activeElement)) region.focus();
    setResolutions((previous) => new Map(previous).set(item.id, item));
  }

  const live = useLiveUpdates(undefined, (item) => {
    if (item.id === itemId) receiveResolution(item);
  });
  const waiting = data.waiting.filter((item) => item.id !== selected?.id || !resolved);
  const automatic = data.linked?.lane === "automatic" && data.linked.id === itemId ? [...data.automatic, data.linked] : data.automatic;
  const shown = filter === "automatic" ? automatic : waiting.filter((item) => inFilter(item, filter));
  const history = resolved && !data.decided.some((item) => item.id === selected.id)
    ? [selected, ...data.decided]
    : data.decided;

  useEffect(() => {
    const panel = dialog.current;
    if (!panel || !hasItem) return;
    if (mobile) {
      panel.showModal();
      return () => panel.close();
    }
    // The desktop pane stays in the normal tab order. Opening it should leave focus on the row.
    panel.open = true;
    return () => { panel.open = false; };
  }, [hasItem, mobile]);

  useEffect(() => {
    if (itemId && !mobile) document.getElementById(rowId(itemId))?.scrollIntoView({ block: "nearest" });
    if (hasItem || !returnFocus.current) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hasItem, itemId, mobile]);

  function closeDetail() {
    returnFocus.current = shown.some((item) => item.id === itemId) && itemId ? rowId(itemId) : filterId(filter);
    if (itemId && window.history.state?.todayQueueItem === itemId) window.history.back();
    else setQueueUrl(filter);
  }

  function chooseFilter(next: Filter) {
    setQueueUrl(next, selected && inFilter(selected, next) ? selected.id : undefined);
  }

  return (
    <>
      <section className="mt-8" aria-labelledby="today-worklist">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="today-worklist" className="text-[24px] leading-tight text-ink">Pharmacist worklist</h2>
          <LiveStatus {...live} />
        </div>
        <div role="group" aria-label="Filter worklist" className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = f === "automatic" ? automatic.length : waiting.filter((item) => inFilter(item, f)).length;
            return (
              <button key={f} id={filterId(f)} type="button" aria-pressed={filter === f} onClick={() => chooseFilter(f)} className={chipClass(filter === f, FOCUS)}>
                {FILTER_LABEL[f]} <span className="tabular-nums text-ink-3">{count}</span>
              </button>
            );
          })}
        </div>
        {!canDecide && <p className="mt-3 text-sm text-ink-3">A pharmacist must approve or decline each waiting item.</p>}
        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {shown.length === 0 ? (
            <TableEmpty>
              {live.connection === "connected" ? EMPTY[filter] : "The worklist will update when the connection is ready."}
            </TableEmpty>
          ) : (
            <ul aria-label={`${FILTER_LABEL[filter]} items`} onKeyDown={moveRowFocus} className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" data-testid="queue">
              {shown.map((d) => (
                <Row key={d.id} d={d} selected={d.id === selected?.id} onSelect={() => setQueueUrl(filter, d.id, mobile)} />
              ))}
            </ul>
          )}
          {!hasItem && (
            <Card className="hidden lg:block" aria-label="Item details">
              <p className="text-sm text-ink-3">{shown.length ? "Select an item to see its reason and call evidence." : "Item details will appear here when you select a record."}</p>
            </Card>
          )}
          <dialog
            ref={dialog}
            aria-labelledby="today-detail-title"
            onCancel={(e) => { e.preventDefault(); closeDetail(); }}
            className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-lg overflow-y-auto overscroll-contain border-l border-line bg-surface p-4 text-ink shadow-card backdrop:bg-ink/30 sm:p-5 lg:sticky lg:inset-auto lg:top-6 lg:h-auto lg:w-full lg:max-w-none lg:overflow-visible lg:rounded-card lg:border"
          >
            {hasItem && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 id="today-detail-title" className="text-xl text-ink">{selected ? "Item details" : "Item unavailable"}</h2>
                  <button type="button" onClick={closeDetail} className={cn("order-first min-h-10 text-sm lg:hidden", linkClass, FOCUS)}>← Back to worklist</button>
                </div>
                {selected ? (
                  <>
                    <ItemPanel key={selected.id} d={selected} />
                    {(resolved || (canDecide && selected.lane !== "automatic")) && (
                      <div
                        ref={decisionRegion}
                        data-item={selected.id}
                        tabIndex={-1}
                        aria-label={resolved ? "Recorded decision" : "Decision controls"}
                        className={cn("mt-5 space-y-2 border-t border-line pt-4", FOCUS)}
                      >
                        <h3 className="font-sans text-sm font-semibold text-ink">{resolved ? "Recorded decision" : "Record a decision"}</h3>
                        <p className="text-sm text-ink-3"><span className="capitalize">{selected.kind}</span> for {selected.patient}{selected.drug ? ` · ${selected.drug}` : ""}</p>
                        {resolved ? (
                          <div role="status"><Outcome item={selected} /></div>
                        ) : (
                          <>
                            <DecideBar key={selected.id} id={selected.id} disabled={live.connection !== "connected"} onDecided={receiveResolution} />
                            {live.connection !== "connected" && <p className="text-xs text-ink-3">Decisions are available when the worklist is current.</p>}
                          </>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-2">
                      {live.connection === "connected" ? "This item is no longer available in the pharmacy queue." : "The worklist is reconnecting. This item may appear when updates resume."}
                    </p>
                    <button type="button" onClick={() => { returnFocus.current = filterId("waiting"); setQueueUrl("waiting"); }} className={cn("mt-3 text-sm", linkClass, FOCUS)}>Show waiting items</button>
                  </>
                )}
              </>
            )}
          </dialog>
        </div>
      </section>

      <section id="recent" className="mt-10 scroll-mt-20" aria-label="Recent">
        <SectionHeader title="Recent" />
        {history.length === 0 ? (
          <TableEmpty>No decisions recorded in the recent history.</TableEmpty>
        ) : (
            <Table data-testid="decided">
              <THead>
                <tr><Th className="w-px pr-2">When</Th><Th>Item</Th><Th>Approval</Th><Th>Note</Th><Th>Record</Th></tr>
              </THead>
              <tbody>
                {history.map((d) => (
                  <Tr key={d.id}>
                    <Td className="w-px pr-2"><HistoryTime iso={d.decidedAt} /></Td>
                    <Td><ItemSummary d={d} /></Td>
                    <Td>
                      <Badge tone={d.status === "approved" ? "accent" : "stop"} dot>{d.status === "approved" ? "Approved" : "Declined"}</Badge>
                      <span className="mt-1 block text-xs leading-tight text-ink-3">{d.decidedBy ?? "Pharmacist"}</span>
                    </Td>
                    <Td className="max-w-64 break-words">{d.decisionNote ?? <span className="text-ink-3">—</span>}</Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/app/pharmacy/calls/${encodeURIComponent(d.callId)}`} className={cn(linkClass, FOCUS)}>Call {d.callId}</Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
        )}
      </section>

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
    </>
  );
}
