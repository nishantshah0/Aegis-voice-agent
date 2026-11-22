"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, Eyebrow, RuleTag, inputClass } from "@/components/ui";
import type { RuleCard } from "@/lib/contract";
import type { RuleDraft } from "@/lib/arena/rule-writer";

const EXAMPLE = "Any antibiotic refill needs a pharmacist.";
const OUTCOME: Record<RuleCard["then"], string> = { refuse: "Refuse", route: "Route to a pharmacist", flag: "Flag for the pharmacist" };
const KIND: Record<string, string> = { should_catch: "Should catch", should_not_catch: "Shouldn't catch", edge: "Edge case" };

const value = (v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) ? v.join(", ") : String(v));

/** The draft form, the draft card with its tests and impact, and the Approve button. */
export function RuleWriter({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLE);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [live, setLive] = useState<RuleCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [ms, setMs] = useState<number | null>(null);

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Failed (${res.status})`);
    return json;
  };

  const write = () =>
    start(async () => {
      setError(null);
      setDraft(null);
      setLive(null);
      const t = performance.now();
      try {
        const json = await post("/api/rules/draft", { text });
        setDraft(json.draft as RuleDraft);
        setMs(Math.round(performance.now() - t));
      } catch (e) {
        setError((e as Error).message);
      }
    });

  const approve = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      try {
        const json = await post(`/api/rules/${encodeURIComponent(draft.id)}/approve`);
        setLive(json.card as RuleCard);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <div className="mt-8 space-y-6">
      <Card as="section">
        <label htmlFor="rule-text" className="text-sm font-medium text-ink">
          The rule, in plain English
        </label>
        <textarea
          id="rule-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={500}
          disabled={!canWrite}
          className={inputClass("mt-2 h-auto w-full py-2 text-[15px]")}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={write} disabled={!canWrite || pending || !text.trim()}>
            {pending && !draft ? "Drafting…" : "Draft the card"}
          </Button>
          {!canWrite && <span className="text-sm text-ink-3">Only a signed-in pharmacist can write and approve rules.</span>}
          {ms !== null && draft && <span className="text-xs text-ink-3">Drafted in {(ms / 1000).toFixed(1)} s</span>}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-stop">
            {error}
          </p>
        )}
      </Card>

      {draft && (
        <Card as="section" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Eyebrow>Draft card {draft.card.id}</Eyebrow>
              {live ? <Badge tone="accent" dot>Live</Badge> : <Badge tone="quick" dot>Draft, not live</Badge>}
            </div>
            <span className="text-xs text-ink-3">{draft.card.author}</span>
          </div>

          <div>
            <p className="text-lg font-medium text-ink">{draft.restatement}</p>
            <p className="mt-1 text-sm text-ink-2">Card wording: &ldquo;{draft.card.wording}&rdquo;</p>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-3">When all of these hold</dt>
              <dd className="mt-1 space-y-1">
                {draft.card.when.map((c, i) => (
                  <code key={i} className="block font-mono text-xs text-ink">
                    {c.field} {c.op} {value(c.value)}
                  </code>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Outcome</dt>
              <dd className="mt-1 text-ink">{OUTCOME[draft.card.then] ?? draft.card.then}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Checked on</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {draft.card.appliesTo.map((b) => (
                  <RuleTag key={b}>{b}</RuleTag>
                ))}
              </dd>
            </div>
          </dl>

          <div>
            <Eyebrow>Tests, run in code (no AI)</Eyebrow>
            <ul className="mt-2 space-y-1.5 text-sm">
              {draft.tests.map((t, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <span aria-hidden className={t.passed ? "text-accent" : "text-stop"}>
                    {t.passed ? "✓" : "✕"}
                  </span>
                  <span className="font-medium text-ink">{KIND[t.kind] ?? t.kind}:</span>
                  <span className="text-ink-2">{t.description}</span>
                  <span className="text-xs text-ink-3">
                    {t.button}, {t.matched ? "card matched" : "card didn't match"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow>Impact</Eyebrow>
            <p className="mt-1 text-sm text-ink-2">
              Replayed over the stored context of every past {draft.impact.button.replace("_", " ")} request: it would have matched{" "}
              <span className="font-medium text-ink">
                {draft.impact.matched} of {draft.impact.total}
              </span>
              {draft.impact.matched > 0 ? ` (${OUTCOME[draft.impact.outcome].toLowerCase()})` : ""}.
            </p>
          </div>

          {draft.problems.length > 0 && (
            <div>
              <Eyebrow>Can&apos;t be approved yet</Eyebrow>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-stop">
                {draft.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {live ? (
              <p className="text-sm text-ink">
                Live: approved by <span className="font-medium">{live.approvedBy}</span> at {live.approvedAt}. The change is in the record.
              </p>
            ) : (
              <>
                <Button variant="approve" onClick={approve} disabled={!canWrite || pending || !draft.ready}>
                  {pending ? "Approving…" : "Approve and put live"}
                </Button>
                <span className="text-xs text-ink-3">Your name and the time go on the card. Check the latest release gate before approving.</span>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
