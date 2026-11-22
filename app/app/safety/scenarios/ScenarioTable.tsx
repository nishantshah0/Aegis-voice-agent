"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, cn } from "@/components/ui";
import type { Status } from "../data";

export type TableRow = {
  id: string;
  persona: string;
  goal: string;
  group: string;
  groupLabel: string;
  inSuite: boolean;
  status: Status;
  caught: number;
  broken: number;
  attempts: { n: number; passed: boolean; failed: string[]; caught: number; broken: number }[];
};

const STATUS_FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "not_run", label: "Not run" },
];

const STATUS_BADGE: Record<Status, { tone: "accent" | "stop" | "neutral"; label: string }> = {
  passed: { tone: "accent", label: "Passed 3 of 3" },
  failed: { tone: "stop", label: "Failed" },
  not_run: { tone: "neutral", label: "Not run" },
};

const words = (id: string) => {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Every scenario card with its latest result. Filters by result and category; hover a dot for that call's checks. */
export function ScenarioTable({ rows, groups }: { rows: TableRow[]; groups: { key: string; label: string }[] }) {
  const [status, setStatus] = useState<"all" | Status>("all");
  const [group, setGroup] = useState<string>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, passed: 0, failed: 0, not_run: 0 };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (group === "all" || r.group === group) &&
      (!query.trim() || `${r.id} ${r.persona} ${r.goal}`.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Result" className="flex rounded-full border border-line bg-surface p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-[13px] transition-colors",
                status === f.key ? "bg-accent text-ink-inverse" : "text-ink-2 hover:text-ink",
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="Category"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="h-8 cursor-pointer rounded-full border border-line bg-surface px-3 text-[13px] text-ink"
        >
          <option value="all">Every category</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scenarios"
          aria-label="Search scenarios"
          className="h-8 min-w-48 flex-1 rounded-full border border-line bg-surface px-3.5 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none sm:max-w-64"
        />
        <span className="ml-auto text-xs text-ink-3">
          {shown.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">No scenario matches these filters.</p>
        ) : (
          <ul>
            {shown.map((r) => (
              <li key={r.id} className="border-t border-line first:border-t-0">
                <Link href={`/app/safety/scenarios/${encodeURIComponent(r.id)}`} className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-accent-soft/50">
                  <div className="min-w-0 flex-1 basis-72">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      {words(r.id)}
                      {!r.inSuite && <Badge>Not in the 28-card suite</Badge>}
                    </p>
                    <p className="truncate text-xs text-ink-3" title={r.goal}>
                      {r.groupLabel} · {r.persona}
                    </p>
                  </div>
                  <ol className="flex items-center gap-1.5" aria-label="Calls">
                    {r.attempts.map((a) => (
                      <li
                        key={a.n}
                        title={`Call ${a.n}: ${a.passed ? "every check passed" : `failed ${a.failed.join(", ") || "a check"}`} · ${a.caught} caught · ${a.broken} broken`}
                        className={cn("size-2.5 rounded-full", a.passed ? "bg-accent" : "bg-stop")}
                      />
                    ))}
                  </ol>
                  <span className="w-20 text-right text-xs tabular-nums text-ink-3" title="Blocked presses and lines across its calls">
                    {r.status === "not_run" ? "" : `${r.caught} caught`}
                  </span>
                  <span className={cn("w-16 text-right text-xs tabular-nums", r.broken > 0 ? "font-semibold text-stop" : "text-ink-3")}>
                    {r.status === "not_run" ? "" : `${r.broken} broken`}
                  </span>
                  <Badge tone={STATUS_BADGE[r.status].tone} dot className="w-28 justify-center">
                    {STATUS_BADGE[r.status].label}
                  </Badge>
                  <span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
