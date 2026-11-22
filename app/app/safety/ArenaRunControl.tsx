"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";

// Starts the scenario suite or the overnight attacker through POST /api/arena/run or
// /api/arena/overnight, then follows it with GET /api/arena/run every two seconds. Every
// number here is what the server reports; the saved results re-read as the run writes them.

type Kind = "suite" | "overnight";
type Run = { kind: Kind; state: "running" | "done" | "failed"; startedAt: string; finishedAt?: string; done: number; total: number; caught: number; broken: number; message?: string };
type Status = { running: Run | null; last: Partial<Record<Kind, Run>>; usage: { used: number; perHour: number } };

const URL_FOR: Record<Kind, string> = { suite: "/api/arena/run", overnight: "/api/arena/overnight" };
const NAME: Record<Kind, string> = { suite: "scenario suite", overnight: "overnight" };
const UNIT: Record<Kind, string> = { suite: "calls saved", overnight: "attack calls" };
const CALL_CHOICES = [5, 10, 20, 60];
const POLL_MS = 2_000;

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export function ArenaRunControl({ kind, label, compact = false }: { kind: Kind; label: string; compact?: boolean }) {
  // useRouter() can be a new object each render; keep it in a ref so polling doesn't restart.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [calls, setCalls] = useState(10);
  const lastDone = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/run", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Status;
      setStatus(next);
      // Re-read the saved results when the run moves on or ends.
      const mark = JSON.stringify([next.running?.done, next.running?.kind, next.last[kind]?.finishedAt]);
      if (lastDone.current && mark !== lastDone.current) routerRef.current.refresh();
      lastDone.current = mark;
    } catch {
      // Try again on the next tick.
    }
  }, [kind]);

  const running = status?.running ?? null;
  const isRunning = running !== null;
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    if (!isRunning) return () => clearTimeout(first);
    const tick = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [load, isRunning]);

  async function start() {
    setError(null);
    setPosting(true);
    try {
      const res = await fetch(URL_FOR[kind], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "overnight" ? { calls } : {}),
      });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      await load();
    } catch {
      setError("Can't reach the server");
    } finally {
      setPosting(false);
    }
  }

  const mine = running?.kind === kind ? running : null;
  const other = running && running.kind !== kind ? running : null;
  const last = status?.last[kind];
  const pct = mine && mine.total > 0 ? Math.min(100, Math.round((mine.done / mine.total) * 100)) : 0;

  return (
    <div className={cn("flex flex-col gap-2", compact ? "items-end text-right" : "")}>
      <div className="flex items-center gap-2">
        {kind === "overnight" && !mine && (
          <select
            aria-label="Attack calls"
            value={calls}
            onChange={(e) => setCalls(Number(e.target.value))}
            className="h-8 cursor-pointer rounded-full border border-line-strong bg-surface px-2.5 text-[13px] text-ink"
          >
            {CALL_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} calls
              </option>
            ))}
          </select>
        )}
        <Button size="sm" disabled={posting || running !== null} onClick={() => void start()} title={other ? `The ${NAME[other.kind]} run is going` : undefined}>
          {(posting || mine) && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
          {posting ? "Starting…" : mine ? "Running…" : label}
        </Button>
      </div>

      {mine && (
        <div className="w-64 max-w-full" aria-live="polite">
          <div className="flex justify-between text-xs text-ink-3">
            <span>Started {time(mine.startedAt)}</span>
            <span className="tabular-nums">
              {mine.done} of {mine.total} {UNIT[kind]}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={mine.done} aria-valuemin={0} aria-valuemax={mine.total}>
            <div className="h-full animate-pulse rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-ink-3">
            {mine.caught} caught · <span className={mine.broken ? "font-semibold text-stop" : ""}>{mine.broken} broken</span> so far
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="max-w-72 text-xs text-stop">
          {error}
        </p>
      )}
      {!mine && !error && other && <p className="max-w-72 text-xs text-ink-3">The {NAME[other.kind]} run is going. One run at a time.</p>}
      {!mine && !error && last && (
        <p className="max-w-72 text-xs text-ink-3">
          {last.state === "failed" ? `Last run failed at ${time(last.finishedAt)}: ${last.message ?? "no reason given"}` : `Last run finished ${time(last.finishedAt)}: ${last.done} ${UNIT[kind]}, ${last.caught} caught, ${last.broken} broken`}
        </p>
      )}
      {status && (
        <p className="text-[11px] text-ink-3" title="Every live run on this machine shares the plan's hourly cap; each model turn waits for room">
          {status.usage.used} of {status.usage.perHour} model calls used this hour
        </p>
      )}
    </div>
  );
}
