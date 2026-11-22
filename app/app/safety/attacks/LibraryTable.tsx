"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, RowNav, RuleTag, Table, TableEmpty, Td, Th, THead, Tr, When, chipClass, inputClass } from "@/components/ui";
import { ruleWords } from "@/app/stage/attacks";
import type { Attack, Category, Kind, Result } from "./library";
import { RunLiveCallButton } from "../live-calls/RunLiveCallButton";

const KIND_LABEL: Record<Kind, string> = { hijack: "Hijack card", scenario: "Scenario", custom: "Your attack", overnight: "Overnight" };
const RESULT: Record<Result | "not_run", { label: string; tone: "accent" | "stop" | "neutral" | "review" }> = {
  caught: { label: "Caught", tone: "accent" },
  held: { label: "Held", tone: "review" },
  broken: { label: "Broken", tone: "stop" },
  not_run: { label: "Not run", tone: "neutral" },
};
const RESULT_HINT: Record<Result | "not_run", string> = {
  caught: "The lock blocked or rerouted at least one thing the attack tried",
  held: "It ran and broke no rule; nothing needed blocking (the agent refused on its own)",
  broken: "A rule broke in the last run: open it",
  not_run: "No saved run yet",
};

/** Every attack, filterable by category, result, attacker and kind. Click a row for its transcript. */
export function LibraryTable({ attacks, categories }: { attacks: Attack[]; categories: Category[] }) {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const [result, setResult] = useState<"all" | Result | "not_run">("all");
  const [attacker, setAttacker] = useState("all");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const label = useMemo(() => new Map(categories.map((c) => [c.id, c.label])), [categories]);
  const attackers = useMemo(() => [...new Set(attacks.map((a) => a.last?.attacker ?? a.attacker))].sort(), [attacks]);
  const resultOf = (a: Attack) => a.last?.result ?? "not_run";

  const shown = attacks.filter(
    (a) =>
      (category === "all" || a.categories.includes(category as Attack["categories"][number])) &&
      (result === "all" || resultOf(a) === result) &&
      (attacker === "all" || (a.last?.attacker ?? a.attacker) === attacker) &&
      (kind === "all" || a.kind === kind),
  );
  const counts = (r: Result | "not_run") => attacks.filter((a) => resultOf(a) === r).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Result" className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={result === "all"} onClick={() => setResult("all")} className={chipClass(result === "all", "cursor-pointer")}>
            All <span className="tabular-nums opacity-70">{attacks.length}</span>
          </button>
          {(["caught", "held", "broken", "not_run"] as const).map((r) => (
            <button key={r} type="button" aria-pressed={result === r} onClick={() => setResult(r)} className={chipClass(result === r, "cursor-pointer")} title={RESULT_HINT[r]}>
              {RESULT[r].label} <span className="tabular-nums opacity-70">{counts(r)}</span>
            </button>
          ))}
        </div>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass("cursor-pointer")}>
          <option value="all">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Attacker" value={attacker} onChange={(e) => setAttacker(e.target.value)} className={inputClass("cursor-pointer")}>
          <option value="all">Every attacker</option>
          {attackers.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)} className={inputClass("cursor-pointer")}>
          <option value="all">Every kind</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-3">
          {shown.length} of {attacks.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <TableEmpty>No attack matches these filters.</TableEmpty>
      ) : (
        <RowNav>
          <Table>
            <THead>
              <tr>
                <Th>Attack</Th>
                <Th>Category</Th>
                <Th>Should be stopped by</Th>
                <Th>Attacker</Th>
                <Th>Last result</Th>
                <Th>Last run</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {shown.map((a) => {
                const r = resultOf(a);
                const href = a.last?.href ?? (a.kind === "scenario" ? `/app/safety/scenarios/${encodeURIComponent(a.id.slice("scenario:".length))}` : null);
                return (
                  <Tr key={a.id} onClick={href ? () => router.push(href) : undefined}>
                    <Td className="max-w-80">
                      <span className="block font-medium text-ink">{a.name}</span>
                      <span className="block truncate text-xs text-ink-3" title={a.tactic}>
                        {KIND_LABEL[a.kind]} · {a.tactic}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex max-w-64 flex-wrap gap-1">
                        {a.categories.map((c) => (
                          <span key={c} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2" title={label.get(c)}>
                            {label.get(c)?.replace(/^LLM\d\d /, "") ?? c}
                          </span>
                        ))}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {a.targetRules.map((rule) => (
                          <span key={rule} title={ruleWords(rule)}>
                            <RuleTag>{rule}</RuleTag>
                          </span>
                        ))}
                      </span>
                    </Td>
                    <Td className="text-xs text-ink-2">{a.last?.attacker ?? a.attacker}</Td>
                    <Td>
                      <span title={a.last ? `${a.last.caught} caught · ${a.last.broken} broken. ${RESULT_HINT[r]}` : RESULT_HINT[r]}>
                        <Badge tone={RESULT[r].tone} dot>
                          {RESULT[r].label}
                        </Badge>
                      </span>
                    </Td>
                    <Td className="text-xs text-ink-3">{a.last ? <When iso={a.last.at} /> : "—"}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>{a.live ? <RunLiveCallButton source={a.live} label="Live" /> : null}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </RowNav>
      )}
    </div>
  );
}
