import Link from "next/link";
import { Badge, Eyebrow, LaneBadge, RuleTag, When } from "@/components/ui";
import type { TodayItem } from "./today";

export const SIGNAL_LABEL: Record<string, string> = {
  early: "Early refill",
  new_address: "New address",
  side_effect: "Side effect reported",
  missed_doses: "Possible missed doses",
  failed_code_attempts: "Failed code attempts",
  speech_guard_replacement: "A line was blocked by the speech guard",
  safety_words: "Safety words",
  attack_alarm: "Attack alarm",
};

/** One line in a list: lane, what, which medicine, whose. */
export function ItemSummary({ d }: { d: TodayItem }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <LaneBadge lane={d.lane} />
      <strong className="font-semibold capitalize text-ink">{d.kind}</strong>
      {d.drug && <span className="text-ink">{d.drug}</span>}
      <span className="text-ink-3">for {d.patient}</span>
      {d.sideEffects.length > 0 && <Badge tone="quick">side effect</Badge>}
      {d.told.some((t) => t.blocked) && <Badge tone="stop">line blocked</Badge>}
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
        <Link href={`/app/pharmacy/calls/${encodeURIComponent(d.callId)}`} className="font-mono text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline">
          {d.callId} →
        </Link>
      </div>
      <p className="-mt-3 text-xs text-ink-3">
        Sent here <When iso={d.createdAt} />
      </p>

      <Section title="Why it's here">
        {d.rules.length === 0 && <p className="text-ink-3">No rule card: sent here by the signals below.</p>}
        <ul className="space-y-1.5">
          {d.rules.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <RuleTag>Rule {r.id}</RuleTag> <span>{r.wording}</span>
            </li>
          ))}
        </ul>
        {d.signals.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {d.signals.map((s) => (
              <li key={s}>
                <Badge>{SIGNAL_LABEL[s] ?? s}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

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

      <Section title="What the patient was told">
        {d.told.length === 0 && <p className="text-ink-3">Nothing yet.</p>}
        <ul className="space-y-1.5">
          {d.told.map((t, i) =>
            t.blocked ? (
              <li key={i}>
                <s className="text-stop decoration-stop">{t.text}</s> <Badge tone="stop">blocked by {t.rule}</Badge>
                <span className="mt-0.5 block text-ink-3">Said instead: {t.replacement}</span>
              </li>
            ) : (
              <li key={i}>
                <span className="text-ink">{t.text}</span> <Badge tone="accent">checked</Badge>
              </li>
            ),
          )}
        </ul>
      </Section>

      <details className="group">
        <summary className="cursor-pointer text-[13px] font-medium text-ink hover:text-accent">Transcript ({d.transcript.length} lines)</summary>
        <ol className="mt-2 flex flex-col gap-1.5">
          {d.transcript.map((l, i) => (
            <li key={i} className={l.who === "caller" ? "max-w-[85%] self-end rounded-xl bg-accent-soft px-3 py-1.5 text-[13px] text-ink" : "max-w-[85%] self-start rounded-xl bg-sunken px-3 py-1.5 text-[13px] text-ink"}>
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
