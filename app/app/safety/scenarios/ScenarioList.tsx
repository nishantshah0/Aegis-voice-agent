"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Table, TableEmpty, Td, Th, THead, Tr, cn, type Tone } from "@/components/ui";
import type { ScenarioRow, ScenarioStatus } from "./data";

const STATUS: Record<ScenarioStatus, { label: string; tone: Tone }> = {
  passed: { label: "Passed", tone: "accent" },
  failed: { label: "Failed", tone: "stop" },
  not_run: { label: "Not run", tone: "neutral" },
};

const label = (group: string) => group.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The scenario cards, filterable by text, group and latest result. */
export function ScenarioList({ rows }: { rows: ScenarioRow[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState<ScenarioStatus | "all">("all");
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group))].sort(), [rows]);
  const shown = rows.filter(
    (r) =>
      (group === "all" || r.group === group) &&
      (status === "all" || r.status === status) &&
      (!query || `${r.id} ${r.persona} ${r.goal}`.toLowerCase().includes(query.toLowerCase())),
  );

  const chip = (active: boolean) =>
    cn("rounded-full px-3 py-1 text-[13px] transition-colors", active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-sunken hover:text-ink");

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="scenario-search">
          Search scenarios
        </label>
        <input
          id="scenario-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scenarios…"
          className="h-9 w-64 rounded-full border border-line-strong bg-surface px-4 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <div className="flex gap-1" role="group" aria-label="Result">
          {(["all", "passed", "failed", "not_run"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={chip(status === s)}>
              {s === "all" ? "Any result" : STATUS[s].label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Group">
        <button type="button" aria-pressed={group === "all"} onClick={() => setGroup("all")} className={chip(group === "all")}>
          All groups
        </button>
        {groups.map((g) => (
          <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={chip(group === g)}>
            {label(g)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {shown.length === 0 ? (
          <TableEmpty>No scenario matches those filters.</TableEmpty>
        ) : (
          <Table data-testid="scenario-table">
            <THead>
              <tr>
                <Th>Scenario</Th>
                <Th>Group</Th>
                <Th>Call</Th>
                <Th>Latest result</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/safety/scenarios/${encodeURIComponent(r.id)}`} className="font-medium text-ink hover:text-accent">
                      {r.persona}
                    </Link>
                    <span className="mt-0.5 block text-xs text-ink-3">{r.goal}</span>
                  </Td>
                  <Td className="whitespace-nowrap">{label(r.group)}</Td>
                  <Td className="whitespace-nowrap capitalize">{r.direction}</Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone} dot>
                      {STATUS[r.status].label}
                    </Badge>
                    {r.attempts > 0 && <span className="ml-2 text-xs text-ink-3">{r.attempts} attempts</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
