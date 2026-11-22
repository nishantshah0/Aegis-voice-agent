import Link from "next/link";
import { Badge, Eyebrow, LANE_LABEL, LANE_TONE, RuleTag, When, linkClass } from "@/components/ui";
import type { TodayItem } from "./today";

export const TODAY_LANE_LABEL = { ...LANE_LABEL, quick_check: "Check" };

export const SIGNAL_LABEL: Record<string, string> = {
  early: "Early refill",
  new_address: "New address",
  side_effect: "Side effect reported",
  missed_doses: "Possible missed doses",
  failed_code_attempts: "Failed code attempts",
  speech_guard_replacement: "A line was blocked by the speech guard",
  safety_words: "Safety concern raised on the call",
  attack_alarm: "Unusual call activity flagged",
};

const SIGNAL_PRIORITY = ["safety_words", "side_effect", "attack_alarm", "failed_code_attempts", "speech_guard_replacement", "missed_doses", "new_address", "early"];

export function routingReason(d: Pick<TodayItem, "lane" | "signals" | "rules" | "questions" | "kind">): string {
  if (d.lane === "automatic") return "Routed automatically.";
  const signal = SIGNAL_PRIORITY.find((flag) => d.signals.some((s) => s === flag));
  if (signal) return SIGNAL_LABEL[signal];
  if (d.rules.length) return d.rules[0].wording;
  if (d.questions.length) return "The patient left a question for the pharmacist.";
  if (d.kind === "escalation") return "The call was handed off to the pharmacist.";
  return "The call record was routed for a pharmacist decision.";
}

export function ItemSummary({ d }: { d: TodayItem }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <Badge tone={LANE_TONE[d.lane]} dot>{TODAY_LANE_LABEL[d.lane]}</Badge>
      <strong className="font-semibold capitalize text-ink">{d.kind}</strong>
      {d.drug && <span className="text-ink">{d.drug}</span>}
      {d.requestedDaysSupply && <span className="text-ink">{d.requestedDaysSupply}-day supply</span>}
      <span className="text-ink-3">for {d.patient}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-2 text-sm text-ink-2">{children}</div>
    </section>
  );
}

/** Everything a pharmacist needs to decide one item, from the store and the record. */
export function ItemPanel({ d }: { d: TodayItem }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ItemSummary d={d} />
        <Link href={`/app/pharmacy/calls/${encodeURIComponent(d.callId)}`} className={`text-xs ${linkClass}`}>
          View call {d.callId}
        </Link>
      </div>
      <p className="-mt-3 text-xs text-ink-3">
        Routed <When iso={d.createdAt} format="short" />
      </p>

      <section className="rounded-lg border border-line bg-sunken/50 px-4 py-3">
        <h3 className="font-sans text-sm font-semibold text-ink">{d.lane === "automatic" ? "Routing outcome" : "Why this needs review"}</h3>
        <p className="mt-1 text-sm text-ink-2">{routingReason(d)}</p>
      </section>

      {d.sideEffects.length > 0 && (
        <Section title="Side effects the patient reported">
          <ul className="list-disc space-y-1 pl-5">
            {d.sideEffects.map((s) => (
              <li key={s}>&ldquo;{s}&rdquo;</li>
            ))}
          </ul>
        </Section>
      )}
      {d.questions.length > 0 && (
        <Section title="Questions for the pharmacist">
          <ul className="list-disc space-y-1 pl-5">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Section>
      )}

      {d.told.some((t) => t.blocked) && <Section title="Blocked lines from the call">
        <ul className="space-y-1.5">
          {d.told.filter((t) => t.blocked).map((t, i) => (
            <li key={i}>
              <s className="text-stop decoration-stop">{t.text}</s> <Badge tone="stop">Blocked by {t.rule}</Badge>
              <span className="mt-0.5 block text-ink-3">Spoken replacement · {t.replacement}</span>
            </li>
          ))}
        </ul>
      </Section>}

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Call transcript ({d.transcript.length} lines)</summary>
        {d.transcript.length === 0 && <p className="mt-2 text-sm text-ink-3">No transcript lines were recorded.</p>}
        <ol className="mt-2 flex flex-col gap-1.5">
          {d.transcript.map((l, i) => (
            <li key={i} className={`max-w-[85%] break-words rounded-xl px-3 py-1.5 text-[13px] text-ink ${l.who === "caller" ? "self-end bg-accent-soft" : "self-start bg-sunken"}`}>
              <strong className="mb-0.5 block text-xs">{l.who === "caller" ? "Caller" : "Agent"}</strong>
              {l.blocked ? (
                <>
                  <s>{l.text}</s> <RuleTag>{l.blocked}</RuleTag>
                </>
              ) : (
                l.text
              )}
            </li>
          ))}
        </ol>
      </details>

      {(d.rules.length > 0 || d.signals.length > 0) && (
        <Section title="Routing rules and signals">
          <ul className="space-y-1.5">
            {d.rules.map((r) => (
              <li key={r.id} className="flex items-baseline gap-2">
                <RuleTag>Rule {r.id}</RuleTag> <span>{r.wording}</span>
              </li>
            ))}
          </ul>
          {d.signals.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {d.signals.map((s) => <li key={s}><Badge>{SIGNAL_LABEL[s] ?? s}</Badge></li>)}
            </ul>
          )}
        </Section>
      )}

      {d.aiView && (
        <div className="rounded-xl border border-dashed border-line-strong p-3 text-sm">
          <Eyebrow>The agent&apos;s own view</Eyebrow>
          <p className="mt-1 text-xs text-ink-3">Self-reported by the AI. Shown for context, never used for decisions.</p>
          <p className="mt-1 text-ink-2">{d.aiView}</p>
        </div>
      )}
    </div>
  );
}
