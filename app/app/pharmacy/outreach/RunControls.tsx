"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { RunChoice } from "./data";

/** "Baseline · seed 1" or "Nov 22, 00:32 UTC · seed 2 · no early reach". */
function label(r: RunChoice): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const when = r.runId === "baseline" ? "Baseline" : `${months[Number(r.ranAt.slice(5, 7)) - 1]} ${Number(r.ranAt.slice(8, 10))}, ${r.ranAt.slice(11, 16)} UTC`;
  return `${when} · seed ${r.outcomeSeed}${r.earlyReach ? "" : " · no early reach"}`;
}

/** Pick a saved run, or make a new one (POST ./outreach/run, which only writes results/sim/). */
export function RunControls({ runs, current }: { runs: RunChoice[]; current?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seed, setSeed] = useState(() => Math.max(0, ...runs.map((r) => r.outcomeSeed)) + 1);
  const [earlyReach, setEarlyReach] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/app/pharmacy/outreach/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcomeSeed: seed, earlyReach }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) {
        setError(body.error ?? `Run failed (${res.status})`);
        return;
      }
      setSeed((s) => s + 1);
      router.push(`/app/pharmacy/outreach?run=${encodeURIComponent(body.runId)}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="sr-only" htmlFor="outreach-run">
          Saved run
        </label>
        <select
          id="outreach-run"
          value={current}
          onChange={(e) => router.push(`/app/pharmacy/outreach?run=${encodeURIComponent(e.target.value)}`)}
          title={current}
          className="h-10 max-w-[22rem] rounded-full border border-line-strong bg-surface px-4 text-sm text-ink"
        >
          {runs.map((r) => (
            <option key={r.runId} value={r.runId}>
              {label(r)}
            </option>
          ))}
        </select>
        <Button onClick={run} disabled={pending}>
          {pending ? "Running…" : "Run simulation"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-ink-2">
        <label className="inline-flex items-center gap-1.5">
          Outcomes seed
          <input
            type="number"
            min={0}
            value={seed}
            onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="h-7 w-20 rounded-md border border-line-strong bg-surface px-2 tabular-nums text-ink"
          />
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={earlyReach} onChange={(e) => setEarlyReach(e.target.checked)} className="accent-[var(--color-accent)]" />
          Early reach for high risk
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-stop">
          {error}
        </p>
      )}
    </div>
  );
}
