import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { Badge, Card, Eyebrow, RuleTag, StatTile, cn } from "@/components/ui";
import { finishedCalls, type ReviewCall } from "./calls";
import { judgeAgreement, latestLabels, readLabels, type Label, type YesNo } from "./labels";
import { LabelForm } from "./LabelForm";

const when = (iso?: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "");
const MARK: Record<YesNo, string> = { outcomeRight: "right outcome", wrongPromise: "promised something wrong", unsafeOrAdvice: "unsafe or advice-like" };

function summarise(label: Label): string {
  const parts = (Object.keys(MARK) as YesNo[])
    .filter((k) => label.marks[k] !== null)
    .map((k) => `${label.marks[k] ? "" : "not "}${MARK[k]}`);
  if (label.marks.tone) parts.push(`tone ${label.marks.tone}`);
  if (label.marks.saveAsTest) parts.push("save as a test");
  return parts.join(", ") || "no marks";
}

function Transcript({ call }: { call: ReviewCall }) {
  if (!call.transcript.length) return <p className="text-sm text-ink-3">Nobody spoke on this call.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {call.transcript.map((line, i) => (
        <li key={i} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", line.who === "caller" ? "self-end bg-accent-soft" : "self-start bg-sunken")}>
          <span className="mr-1.5 text-xs text-ink-3">{line.who === "caller" ? "Caller" : "Agent"}</span>
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
  );
}

function CallCard({ call, labels, mine }: { call: ReviewCall; labels: Label[]; mine?: Label }) {
  return (
    <Card as="article" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{call.callId}</span>
        <Badge>{call.direction}</Badge>
        <span className="text-sm text-ink-2">{call.patient}</span>
        <span className="ml-auto text-xs text-ink-3">ended {when(call.endedAt)}</span>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {call.outcome.map((o) => (
          <Badge key={o} tone={o.includes("Review") ? "review" : o.includes("Quick") ? "quick" : "neutral"}>
            {o}
          </Badge>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-5">
          <section>
            <Eyebrow>Transcript</Eyebrow>
            <div className="mt-2">
              <Transcript call={call} />
            </div>
          </section>
          <section>
            <Eyebrow>Buttons pressed</Eyebrow>
            {call.buttons.length ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {call.buttons.map((b, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{b.button}</span>
                    {b.decision && <Badge tone={b.decision === "blocked" ? "stop" : b.decision === "routed" ? "review" : "accent"}>{b.decision}</Badge>}
                    {b.ruleIds.map((r) => (
                      <RuleTag key={r}>{r}</RuleTag>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-3">No buttons pressed.</p>
            )}
          </section>
          <section>
            <Eyebrow>Blocked lines</Eyebrow>
            {call.blocked.length ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {call.blocked.map((b, i) => (
                  <li key={i}>
                    <RuleTag>{b.rule}</RuleTag> <s className="text-stop">{b.text}</s> <span className="text-ink-3">→ said instead:</span> {b.replacement}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-3">The speech guard blocked nothing.</p>
            )}
          </section>
        </div>
        <section className="flex flex-col gap-4 rounded-card border border-line bg-canvas p-4">
          <Eyebrow>Your label</Eyebrow>
          <LabelForm callId={call.callId} {...(mine ? { initial: mine.marks } : {})} />
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
    </Card>
  );
}

// The Review calls tab (SPEC Part 2): hand labelling of finished calls from the store's
// record. Signed out: a count only, since transcripts hold patient details.
export async function ReviewCalls() {
  await connection(); // Live data: never prerender.
  const [approver, calls, labels] = await Promise.all([getApprover(), finishedCalls(getStore()), readLabels()]);

  if (!approver) {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <StatTile label="Finished calls" value={calls.length.toLocaleString("en-US")} className="max-w-xs" />
        <p className="text-sm text-ink-2">
          <a href={AUTH_ROUTES.login} className="underline">
            Sign in
          </a>{" "}
          as a pharmacist or reviewer to read and label calls.
        </p>
      </div>
    );
  }

  const latest = latestLabels(labels);
  const agreement = await judgeAgreement(labels);
  const labelled = calls.filter((c) => latest.has(c.callId)).length;
  const tests = calls.filter((c) => latest.get(c.callId)?.some((l) => l.marks.saveAsTest)).length;

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Finished calls" value={calls.length.toLocaleString("en-US")} />
        <StatTile label="Labelled by people" value={labelled.toLocaleString("en-US")} />
        <StatTile label="Saved as tests" value={tests.toLocaleString("en-US")} />
      </div>

      <section>
        <Eyebrow>AI judge</Eyebrow>
        <Card className="mt-2">
          {agreement && agreement.compared > 0 ? (
            <>
              <p className="text-sm">
                The AI judge agrees with people on <span className="font-semibold tabular-nums">{agreement.agreed.toLocaleString("en-US")}</span> of{" "}
                <span className="font-semibold tabular-nums">{agreement.compared.toLocaleString("en-US")}</span> answers.
              </p>
              {agreement.disagreements.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
                  {agreement.disagreements.map((d, i) => (
                    <li key={i}>
                      <span className="font-mono">{d.callId}</span>, {MARK[d.mark]}: judge says {d.judge ? "yes" : "no"}, people say {d.people ? "yes" : "no"}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : agreement ? (
            <p className="text-sm text-ink-2">AI judge results are saved, but none are for a call people have labelled yet.</p>
          ) : (
            <p className="text-sm text-ink-2">No AI judge results saved under results/arena/judge/, so there&apos;s no agreement rate yet.</p>
          )}
        </Card>
      </section>

      {calls.length ? (
        calls.map((call) => {
          const forCall = latest.get(call.callId) ?? [];
          const mine = forCall.find((l) => l.by.id === approver.id);
          return <CallCard key={call.callId} call={call} labels={forCall} {...(mine ? { mine } : {})} />;
        })
      ) : (
        <Card>
          <p className="text-sm text-ink-2">No finished calls yet. A call shows up here once it ends.</p>
        </Card>
      )}
    </div>
  );
}
