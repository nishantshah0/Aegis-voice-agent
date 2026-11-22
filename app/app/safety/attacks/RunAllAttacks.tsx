"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, When, cn } from "@/components/ui";
import type { RunAll } from "@/app/api/_lib/run-all";
import type { Attack } from "./library";
import { getAttacker } from "../AttackerPicker";

// "Run all attacks": starts POST /api/arena/all and follows GET every two seconds. The final
// line counts the library's own results from this run (re-read from results/), never a guess.

const STATE_TONE: Record<string, "neutral" | "accent" | "review" | "stop"> = { waiting: "neutral", running: "review", done: "accent", skipped: "neutral", failed: "stop" };

export function RunAllAttacks({ attacks }: { attacks: Attack[] }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [status, setStatus] = useState<{ running: RunAll | null; last: RunAll | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const seen = useRef("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/all", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as { running: RunAll | null; last: RunAll | null };
      setStatus(next);
      const mark = JSON.stringify(next.running?.steps.map((s) => [s.state, s.done]) ?? next.last?.finishedAt);
      if (seen.current && mark !== seen.current) routerRef.current.refresh();
      seen.current = mark;
    } catch {
      // Try again on the next tick.
    }
  }, []);

  const running = status?.running ?? null;
  const isRunning = running !== null;
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    if (!isRunning) return () => clearTimeout(first);
    const tick = setInterval(() => void load(), 2000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [load, isRunning]);

  async function start() {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/arena/all", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attacker: getAttacker() }) });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      await load();
    } catch {
      setError("Can't reach the server");
    } finally {
      setPosting(false);
    }
  }

  const shown = running ?? status?.last ?? null;
  // The library's own results from this run: attacks whose last result is from after it started.
  const since = shown?.startedAt ?? "";
  const ran = since ? attacks.filter((a) => a.last && a.last.at >= since) : [];
  const tally = { caught: ran.filter((a) => a.last?.result === "caught").length, held: ran.filter((a) => a.last?.result === "held").length, broken: ran.filter((a) => a.last?.result === "broken").length };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Run all attacks</h2>
          <p className="mt-0.5 max-w-xl text-xs text-ink-3">
            The hijack batch (a scripted, fully fooled AI), then every attack scenario on the live agent, then each of your attacks as a live call. One run at a time, paced under the hourly cap.
          </p>
        </div>
        <Button onClick={() => void start()} disabled={posting || isRunning}>
          {(posting || isRunning) && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
          {posting ? "Starting…" : isRunning ? "Running…" : "Run all attacks"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-stop">
          {error}
        </p>
      )}
      {shown && (
        <>
          <ol className="grid gap-2 md:grid-cols-3" aria-live="polite">
            {shown.steps.map((s, i) => {
              const pct = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
              return (
                <li key={s.key} className={cn("rounded-xl border p-3", s.state === "running" ? "border-review" : "border-line")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {i + 1}. {s.label}
                    </span>
                    <Badge tone={STATE_TONE[s.state] ?? "neutral"} dot>
                      {s.state}
                    </Badge>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className={cn("h-full rounded-full bg-accent transition-[width] duration-700", s.state === "running" && "animate-pulse")} style={{ width: `${s.state === "done" ? 100 : pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs tabular-nums text-ink-3">
                    {s.state === "skipped" ? s.message : `${s.done} of ${s.total} · ${s.caught} caught · ${s.broken} broken`}
                    {s.state === "failed" && s.message ? ` · ${s.message}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-ink-2">
            {running ? "Started" : "Last run started"} <When iso={shown.startedAt} />
            {!running && (
              <>
                {" · "}
                <span className="font-semibold text-ink">{ran.length} attacks</span> ran: {tally.caught} caught, {tally.held} held,{" "}
                <span className={tally.broken ? "font-semibold text-stop" : "font-semibold text-accent"}>{tally.broken} broken</span>
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
