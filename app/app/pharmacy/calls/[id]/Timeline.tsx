"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, LaneBadge, RuleTag, cn, type Tone, chipClass } from "@/components/ui";
import { auditTimestamp, label } from "../../_parts/format";
import type { EventGroup, TimelineEvent } from "./detail";

const GROUPS: { key: EventGroup | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "speech", label: "Transcript" },
  { key: "button", label: "Buttons" },
  { key: "blocked", label: "Blocked lines" },
  { key: "safety", label: "Safety checks" },
  { key: "decision", label: "Decision" },
];
const DECISION_TONE: Record<string, Tone> = { allowed: "accent", routed: "review", blocked: "stop", flagged: "quick" };
const DECISION_LABEL: Record<string, string> = { allowed: "allowed", routed: "routed", blocked: "refused", flagged: "flagged" };

function Meta({ e }: { e: TimelineEvent }) {
  return (
    <time dateTime={e.at} className="shrink-0 text-[11px] text-ink-3" title={`Record entry ${e.seq}`}>
      {auditTimestamp(e.at)} · #{e.seq}
    </time>
  );
}

function Raw({ e }: { e: TimelineEvent }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs">
      {e.context && (
        <div>
          <p className="mb-1 text-ink-3">Rule inputs saved with this event</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-sunken p-2 font-mono text-[11px] text-ink-2">{e.context}</pre>
        </div>
      )}
      {e.input && (
        <div>
          <p className="mb-1 text-ink-3">Input</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-sunken p-2 font-mono text-[11px] text-ink-2">{e.input}</pre>
        </div>
      )}
      {e.output && (
        <div>
          <p className="mb-1 text-ink-3">Result</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-sunken p-2 font-mono text-[11px] text-ink-2">{e.output}</pre>
        </div>
      )}
      <p className="font-mono text-[11px] break-all text-ink-3">
        prev {e.prevHash.slice(0, 16)}… → hash {e.hash.slice(0, 16)}…
      </p>
    </div>
  );
}

function Speech({ e }: { e: TimelineEvent }) {
  const caller = e.who === "caller";
  return (
    <li id={`event-${e.seq}`} className={cn("flex scroll-mt-24 flex-col gap-1", caller ? "items-end" : "items-start")}>
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", caller ? "bg-accent-soft text-ink" : "bg-sunken text-ink")}>{e.text}</div>
      <span className="flex items-center gap-2 text-[11px] text-ink-3">
        {caller ? "Caller · checked first" : "Agent · passed the speech guard"} <Meta e={e} />
      </span>
    </li>
  );
}

function Blocked({ e }: { e: TimelineEvent }) {
  return (
    <li className="flex flex-col items-start gap-1">
      <div className="max-w-[85%] rounded-2xl border border-stop/30 bg-stop-soft px-3.5 py-2 text-sm">
        <s className="text-stop">{e.text}</s>
        <span className="mt-1 block text-ink-2">
          <span className="text-ink-3">Said instead:</span> {e.replacement}
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        Blocked by <Link href={`/app/safety/rules#rule-${encodeURIComponent(e.rule ?? "")}`} className="hover:underline"><RuleTag>{e.rule}</RuleTag></Link>, never spoken <Meta e={e} />
      </span>
    </li>
  );
}

function Entry({ e, open, toggle }: { e: TimelineEvent; open: boolean; toggle: () => void }) {
  const tone = e.group === "decision" ? "accent" : e.group === "safety" ? "neutral" : undefined;
  return (
    <li id={`event-${e.seq}`} className="scroll-mt-24 rounded-xl border border-line bg-surface">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none">
        {e.group === "button" ? (
          <>
            <span className="font-mono text-[13px] text-ink">{e.button}</span>
            {e.decision && <Badge tone={DECISION_TONE[e.decision] ?? "neutral"}>{DECISION_LABEL[e.decision] ?? e.decision}</Badge>}
          </>
        ) : (
          <Badge tone={tone ?? "neutral"}>{e.group === "decision" ? "Pharmacist" : e.group === "safety" ? "Safety check" : label(e.kind)}</Badge>
        )}
        {e.ruleIds.map((id) => (
          <Link key={id} href={`/app/safety/rules#rule-${encodeURIComponent(id)}`} className="hover:underline"><RuleTag>{id}</RuleTag></Link>
        ))}
        {e.lane && <LaneBadge lane={e.lane} />}
        {e.summary && <span className="min-w-0 flex-1 truncate text-ink-2">{e.summary}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Meta e={e} />
          <span aria-hidden className={cn("text-ink-3 transition-transform", open && "rotate-90")}>›</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          <Raw e={e} />
        </div>
      )}
    </li>
  );
}

/** The call's record, in order. Filter by kind; open any press or check for its input, result and hashes. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  const [group, setGroup] = useState<EventGroup | "all">("all");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const shown = useMemo(() => events.filter((e) => group === "all" || e.group === group), [events, group]);
  const toggle = (seq: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Show">
        {GROUPS.map((g) => {
          const count = g.key === "all" ? events.length : events.filter((e) => e.group === g.key).length;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={group === g.key}
              onClick={() => setGroup(g.key)}
              className={chipClass(group === g.key, "h-7 px-2.5 text-xs")}
            >
              {g.label} <span className="tabular-nums text-ink-3">{count}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(open.size ? new Set() : new Set(shown.filter((e) => e.group !== "speech" && e.group !== "blocked").map((e) => e.seq)))}
          className="ml-auto text-xs text-accent hover:underline"
        >
          {open.size ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Nothing of this kind on this call.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3" data-testid="timeline">
          {shown.map((e) =>
            e.group === "speech" ? (
              <Speech key={e.seq} e={e} />
            ) : e.group === "blocked" ? (
              <Blocked key={e.seq} e={e} />
            ) : (
              <Entry key={e.seq} e={e} open={open.has(e.seq)} toggle={() => toggle(e.seq)} />
            ),
          )}
        </ol>
      )}
    </div>
  );
}
