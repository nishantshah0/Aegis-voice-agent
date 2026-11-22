import type { QueueItem } from "@/lib/contract";
import { LaneBadge, RuleTag, cn } from "@/components/ui";
import { triedToSay } from "./attacks";
import type { StageCall } from "./state";

// The real call on the stage (AUDIT #7): its transcript as it happens, struck lines where the
// speech guard stepped in, and what's waiting for a pharmacist. Lines come only to signed-in
// screens, the same as /api/events.

const KIND: Record<QueueItem["kind"], string> = {
  refill: "Refill",
  renewal: "Renewal",
  delivery: "Delivery",
  note: "Note",
  escalation: "Call back",
};

function Heading({ call }: { call: StageCall | undefined }) {
  if (!call) return <span className="text-ink-3">Waiting for the next call</span>;
  return (
    <span className="flex items-center gap-3">
      {call.live ? (
        <span className="inline-flex items-center gap-2 font-semibold text-accent">
          <span className="size-2 rounded-full bg-accent rg-ring" aria-hidden />
          Live call
        </span>
      ) : (
        <span className="text-ink-2">Last call · waiting for the next call</span>
      )}
      <span className="font-mono text-sm text-ink-3">{call.id}</span>
    </span>
  );
}

export function Transcript({ call, signedIn }: { call: StageCall | undefined; signedIn: boolean }) {
  return (
    <div className="flex min-h-64 flex-col rounded-card border border-line bg-surface p-6">
      <h2 className="text-base font-medium">
        <Heading call={call} />
      </h2>
      {call && call.lines.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {call.lines.map((line) => (
            <li key={line.id} className="flex gap-4 text-xl leading-snug">
              <span className="w-20 shrink-0 pt-1 text-sm font-medium uppercase tracking-[0.06em] text-ink-3">{line.who === "caller" ? "Caller" : "Aegis"}</span>
              {line.struck ? (
                <span className="flex flex-wrap items-baseline gap-2">
                  {line.text ? (
                    <span className="text-ink-3 line-through decoration-stop decoration-2">{line.text}</span>
                  ) : (
                    <span className="italic text-ink-3">{triedToSay(line.struck, "").text}</span>
                  )}
                  <RuleTag className="border-stop text-stop">{line.struck}</RuleTag>
                </span>
              ) : (
                <span className={cn(line.who === "caller" ? "text-ink-2" : "text-ink")}>{line.text}</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 text-lg text-ink-3">
          {call && !signedIn
            ? "The transcript shows when this screen is signed in. Presses and the queue are public."
            : call
              ? "No words on this call yet."
              : "When a patient calls, or Aegis calls them, the conversation shows here."}
        </p>
      )}
    </div>
  );
}

export function QueuePanel({ queue }: { queue: QueueItem[] }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-base font-medium text-ink-2">Waiting for a pharmacist</h2>
      {queue.length === 0 ? (
        <p className="mt-6 text-lg text-ink-3">Nothing waiting.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {queue.slice(0, 6).map((item) => (
            <li key={item.id} className="rounded-xl border border-line bg-canvas px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold text-ink">{KIND[item.kind]}</span>
                <LaneBadge lane={item.lane} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                {item.ruleIds.map((id) => (
                  <RuleTag key={id}>rule {id}</RuleTag>
                ))}
                {item.notes.map((n) => (
                  <span key={n.id} className="text-ink-2">
                    {n.kind === "side_effect" ? "Side effect: " : "Question: "}
                    {n.text}
                  </span>
                ))}
                <span className="ml-auto font-mono text-xs">{item.callId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
