import Link from "next/link";
import { Badge, Eyebrow, RuleTag, cn, When } from "@/components/ui";
import type { ReviewCall } from "@/app/console/review/calls";
import type { Label, YesNo } from "@/app/console/review/labels";
import { LabelForm } from "@/app/console/review/LabelForm";

export const MARK: Record<YesNo, string> = { outcomeRight: "right outcome", wrongPromise: "promised something wrong", unsafeOrAdvice: "unsafe or advice-like" };

export function summarise(label: Label): string {
  const parts = (Object.keys(MARK) as YesNo[]).filter((k) => label.marks[k] !== null).map((k) => `${label.marks[k] ? "" : "not "}${MARK[k]}`);
  if (label.marks.tone) parts.push(`tone ${label.marks.tone}`);
  if (label.marks.saveAsTest) parts.push("save as a test");
  return parts.join(", ") || "no marks";
}

/** One finished call to label: what happened, and the five questions. */
export function ReviewCard({ call, labels, mine }: { call: ReviewCall; labels: Label[]; mine?: Label }) {
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-2">
        <Link href={`/app/pharmacy/calls/${encodeURIComponent(call.callId)}`} className="font-mono text-sm font-medium underline-offset-4 hover:underline">
          {call.callId}
        </Link>
        <Badge>{call.direction}</Badge>
        <span className="text-sm text-ink-2">{call.patient}</span>
        <span className="ml-auto text-xs text-ink-3">
          ended <When iso={call.endedAt} />
        </span>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {call.outcome.map((o) => (
          <Badge key={o} tone={o.includes("Review") ? "review" : o.includes("Quick") ? "quick" : "neutral"}>
            {o}
          </Badge>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-5">
          <section>
            <Eyebrow>Transcript</Eyebrow>
            {call.transcript.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Nobody spoke on this call.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-2">
                {call.transcript.map((line, i) => (
                  <li key={i} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", line.who === "caller" ? "self-end bg-accent-soft" : "self-start bg-sunken")}>
                    {line.blocked ? (
                      <>
                        <s className="text-stop">{line.text}</s> <RuleTag>{line.blocked}</RuleTag> <span className="text-xs text-ink-3">blocked, never spoken</span>
                      </>
                    ) : (
                      line.text
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <Eyebrow>Buttons pressed</Eyebrow>
            {call.buttons.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">No buttons pressed.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5 text-sm">
                {call.buttons.map((b, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5">
                    <span className="font-mono text-xs">{b.button}</span>
                    {b.decision && <Badge tone={b.decision === "blocked" ? "stop" : b.decision === "routed" ? "review" : "accent"}>{b.decision}</Badge>}
                    {b.ruleIds.map((r) => (
                      <RuleTag key={r}>{r}</RuleTag>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {call.blocked.length > 0 && (
            <section>
              <Eyebrow>Blocked lines</Eyebrow>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {call.blocked.map((b, i) => (
                  <li key={i}>
                    <RuleTag>{b.rule}</RuleTag> <s className="text-stop">{b.text}</s> <span className="text-ink-3">→ said instead:</span> {b.replacement}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section className="flex flex-col gap-4 rounded-card border border-line bg-canvas p-4">
          <Eyebrow>Your label</Eyebrow>
          <LabelForm key={call.callId} callId={call.callId} {...(mine ? { initial: mine.marks } : {})} />
          {labels.length > 0 && (
            <div>
              <Eyebrow>Saved labels</Eyebrow>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-ink-2">
                {labels.map((l) => (
                  <li key={l.by.id}>
                    <span className="font-medium text-ink">{l.by.name}</span> ({l.by.role}): {summarise(l)}
                    {l.note ? ` · "${l.note}"` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
