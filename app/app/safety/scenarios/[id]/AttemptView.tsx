"use client";

import { useState } from "react";
import { Badge, RuleTag, cn } from "@/components/ui";
import type { AttemptScore, Entry } from "../../data";

export type AttemptData = { n: number; callId: string; file: string; record: Entry[]; score: AttemptScore | null; chainIntact: boolean };

const VIEWS = ["Transcript", "Checks", "Record"] as const;
type View = (typeof VIEWS)[number];

const DECISION_TONE: Record<string, "accent" | "stop" | "quick" | "review" | "neutral"> = {
  allowed: "accent",
  refused: "stop",
  blocked: "stop",
  routed: "quick",
  flagged: "review",
};

const short = (h: string) => (h ? `${h.slice(0, 8)}…` : "—");

/** One scenario's saved calls: pick a call, then read it as a transcript, its checks, or the raw record. */
export function AttemptView({ attempts }: { attempts: AttemptData[] }) {
  const [pick, setPick] = useState(attempts[0]?.n ?? 1);
  const [view, setView] = useState<View>("Transcript");
  const a = attempts.find((x) => x.n === pick) ?? attempts[0];
  if (!a) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Calls" className="flex gap-1">
          {attempts.map((x) => (
            <button
              key={x.n}
              role="tab"
              type="button"
              aria-selected={x.n === a.n}
              onClick={() => setPick(x.n)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                x.n === a.n ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-full", x.score?.passed ? "bg-accent" : "bg-stop")} />
              Call {x.n}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="View" className="ml-auto flex rounded-full border border-line bg-surface p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("cursor-pointer rounded-full px-3 py-1 text-[13px]", view === v ? "bg-accent text-ink-inverse" : "text-ink-2 hover:text-ink")}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-mono">{a.callId}</span>·
        {a.score ? (
          <>
            <Badge tone={a.score.passed ? "accent" : "stop"} dot>
              {a.score.passed ? "Every check passed" : "A check failed"}
            </Badge>
            <span>{a.score.caught} caught</span>·<span className={a.score.broken ? "font-semibold text-stop" : ""}>{a.score.broken} broken</span>·
          </>
        ) : null}
        <span>{a.record.length} record entries</span>·
        <span title="Each entry's prevHash is the hash of the entry before it">{a.chainIntact ? "Hash chain links intact" : "Hash chain link broken"}</span>·
        <code className="font-mono" title={a.file}>
          {a.file}
        </code>
      </div>

      {view === "Transcript" && <Transcript record={a.record} />}
      {view === "Checks" && <Checks score={a.score} />}
      {view === "Record" && <Record record={a.record} />}
    </div>
  );
}

function Transcript({ record }: { record: Entry[] }) {
  const items = record.filter((e) => e.kind === "caller_line" || e.kind === "line_spoken" || e.kind === "line_blocked" || e.kind === "button" || (e.kind === "safety" && e.actor === "caller"));
  if (!items.length) return <p className="text-sm text-ink-3">Nothing was said or pressed in this call.</p>;
  return (
    <ol className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-5 shadow-card">
      {items.map((e) => (
        <li key={`${e.seq}-${e.kind}`} className={cn("flex", e.kind === "caller_line" ? "justify-end" : "justify-start")}>
          <TranscriptItem e={e} />
        </li>
      ))}
    </ol>
  );
}

function TranscriptItem({ e }: { e: Entry }) {
  if (e.kind === "caller_line") {
    return <p className="max-w-[75%] rounded-2xl rounded-br-md bg-sunken px-4 py-2.5 text-[15px]">{e.text}</p>;
  }
  if (e.kind === "line_spoken") {
    return <p className="max-w-[75%] rounded-2xl rounded-bl-md border border-line px-4 py-2.5 text-[15px]">{e.text}</p>;
  }
  if (e.kind === "line_blocked") {
    return (
      <div className="max-w-[75%] rounded-2xl rounded-bl-md border-2 border-stop/50 bg-stop-soft/40 px-4 py-2.5 text-[15px]" title={e.why ? `Why: ${e.why}` : undefined}>
        <p className="flex items-center gap-2 text-xs font-medium text-stop">
          <RuleTag className="border-stop/40 text-stop">{e.rule}</RuleTag> Line replaced before it was spoken
        </p>
        <p className="mt-1.5 text-ink-3 line-through decoration-stop decoration-2">{e.text}</p>
        <p className="mt-1">{e.replacement}</p>
      </div>
    );
  }
  if (e.kind === "safety") {
    return (
      <div className="max-w-[75%] rounded-2xl rounded-br-md border border-review/40 bg-review-soft/50 px-4 py-2.5 text-[15px]">
        <p className="text-xs font-medium text-review">Safety check on the caller&apos;s line: {e.decision}</p>
        <p className="mt-1">{e.text}</p>
        {e.replacement && <p className="mt-1 text-ink-2">Said: {e.replacement}</p>}
      </div>
    );
  }
  return (
    <div className="group flex max-w-[85%] flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 font-mono text-[13px]" title={e.input ? `Pressed with ${JSON.stringify(e.input)}` : undefined}>
      <span className="text-ink-3">pressed</span>
      <span className="font-semibold">{e.button}</span>
      <Badge tone={DECISION_TONE[e.decision] ?? "neutral"}>{e.decision}</Badge>
      {e.ruleIds.map((r) => (
        <RuleTag key={r}>{r}</RuleTag>
      ))}
    </div>
  );
}

function Checks({ score }: { score: AttemptScore | null }) {
  if (!score) return <p className="text-sm text-ink-3">This call&apos;s file has no score.</p>;
  return (
    <div className="flex flex-col gap-4">
      <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {score.checks.map((c) => (
          <li key={c.id} className="flex items-center gap-3 border-t border-line px-5 py-3 first:border-t-0">
            <span aria-hidden className={cn("size-2 rounded-full", c.passed ? "bg-accent" : "bg-stop")} />
            <span className="font-mono text-[13px]">{c.id}</span>
            {c.violation && (
              <span className="text-xs text-ink-3" title="If this check fails, it counts as a broken rule">
                safety check
              </span>
            )}
            <Badge tone={c.passed ? "accent" : c.violation ? "stop" : "quick"} className="ml-auto">
              {c.passed ? "Passed" : c.violation ? "Broken" : "Wrong outcome"}
            </Badge>
          </li>
        ))}
      </ul>
      {score.manualReview.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">For a person to judge (not scored)</p>
          <ul className="mt-2 list-disc pl-5 text-ink-2">
            {score.manualReview.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Record({ record }: { record: Entry[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-xs text-ink-3">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Kind</th>
            <th className="px-4 py-2 font-medium">Actor</th>
            <th className="px-4 py-2 font-medium">What</th>
            <th className="px-4 py-2 font-medium">Decision</th>
            <th className="px-4 py-2 font-medium">Hash</th>
          </tr>
        </thead>
        <tbody>
          {record.map((e) => (
            <tr key={`${e.seq}-${e.hash}`} className="border-t border-line align-top hover:bg-sunken/60">
              <td className="px-4 py-2 tabular-nums text-ink-3">{e.seq}</td>
              <td className="px-4 py-2 font-mono">{e.kind}</td>
              <td className="px-4 py-2 text-ink-2">{e.actor}</td>
              <td className="max-w-md px-4 py-2">
                {e.button ? <span className="font-mono">{e.button}</span> : e.text}
                {e.ruleIds.length > 0 && <span className="ml-2 text-ink-3">rule {e.ruleIds.join(", ")}</span>}
              </td>
              <td className="px-4 py-2">
                <Badge tone={DECISION_TONE[e.decision] ?? "neutral"}>{e.decision || "—"}</Badge>
              </td>
              <td className="px-4 py-2 font-mono text-ink-3" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
                {short(e.hash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
