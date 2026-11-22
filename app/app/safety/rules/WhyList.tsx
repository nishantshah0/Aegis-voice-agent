"use client";

import { useState } from "react";
import { Badge, RuleTag, When, chipClass, cn } from "@/components/ui";
import type { Why } from "../data";

export type WhyItem = Why & { group: string };

const GROUPS = ["All", "Core rules", "Speech rules", "Attack cards", "The hijack"] as const;

/** Each traced rule: the line of code that enforces it, and the commit (and AI session, if any) that wrote it. */
export function WhyList({ items }: { items: WhyItem[] }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("All");
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const present = GROUPS.filter((g) => g === "All" || items.some((i) => i.group === g));
  const shown = items.filter((i) => group === "All" || i.group === group);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Kind of rule" className="flex flex-wrap gap-1">
        {present.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
            className={chipClass(group === g, "cursor-pointer")}
          >
            {g} <span className="tabular-nums opacity-70">{g === "All" ? items.length : items.filter((i) => i.group === g).length}</span>
          </button>
        ))}
      </div>
      <ul className="grid items-start gap-2 md:grid-cols-2">
        {shown.map((w) => {
          const isOpen = open === w.id;
          return (
            <li key={w.id} className={cn("rounded-card border bg-surface shadow-card transition-colors", isOpen ? "border-accent/50" : "border-line")}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : w.id)} className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left">
                <RuleTag className="mt-0.5">{w.id}</RuleTag>
                <span className="flex-1 text-sm font-medium">{w.title}</span>
                <Badge tone={w.status === "checkpoint" ? "accent" : "neutral"}>{w.status === "checkpoint" ? "AI session" : "Commit"}</Badge>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 border-t border-line px-4 py-3 text-xs text-ink-2">
                  <p className="font-mono text-ink-3">
                    {w.file}:{w.line}
                  </p>
                  {w.content && <pre className="overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] text-ink whitespace-pre-wrap">{w.content}</pre>}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-ink-3">Commit</dt>
                    <dd className="font-mono">{w.commit || "—"}</dd>
                    {w.author && (
                      <>
                        <dt className="text-ink-3">By</dt>
                        <dd>
                          {w.author}
                          {w.authorTime && (
                            <>
                              {" · "}
                              <When iso={w.authorTime} />
                            </>
                          )}
                        </dd>
                      </>
                    )}
                    {w.agent && (
                      <>
                        <dt className="text-ink-3">Written with</dt>
                        <dd>
                          {w.agent}
                          {w.model ? ` (${w.model})` : ""}
                        </dd>
                      </>
                    )}
                    {w.checkpointId && (
                      <>
                        <dt className="text-ink-3">Checkpoint</dt>
                        <dd className="font-mono" title="entire explain shows the session behind this checkpoint">
                          {w.checkpointId}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
