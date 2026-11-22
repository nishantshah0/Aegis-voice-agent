"use client";

import { useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import type { StreamEvent } from "@/lib/contract";
import { listenToEvents } from "@/lib/events/client";
import { Badge, Card, cn } from "@/components/ui";
import { GATE_CSS, Gate, HijackControls } from "@/app/stage/HijackPanel";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { initialStage, latestHijack, stageReducer, type StageState } from "@/app/stage/state";
import { BATCH_ORDER, batchDone, batchReducer, cardStatus, initialBatch, type BatchLive, type CardStatus } from "./progress";

type Both = { stage: StageState; batch: BatchLive };
const reduce = (s: Both, a: { event: StreamEvent; id: number }): Both => ({
  stage: stageReducer(s.stage, a.event, a.id),
  batch: batchReducer(s.batch, a.event),
});

const TITLE = new Map(STAGE_ATTACKS.map((a) => [a.id, a]));
const STATUS_TONE: Record<CardStatus, "neutral" | "accent" | "review"> = { waiting: "neutral", running: "review", done: "accent" };
const STATUS_WORDS: Record<CardStatus, string> = { waiting: "Waiting", running: "Attacking…", done: "Done" };

/** The hijack controls and the gate from /stage, plus the batch's progress, all from live events. */
export function AttackDesk() {
  const [state, dispatch] = useReducer(reduce, undefined, () => ({ stage: initialStage(), batch: initialBatch() }));
  useEffect(() => listenToEvents((event, id) => dispatch({ event, id })), []);

  // When a batch finishes, re-read the saved batch below (it was saved before each score event).
  const router = useRouter();
  const done = batchDone(state.batch);
  const seen = useRef(false);
  useEffect(() => {
    if (done && !seen.current) router.refresh();
    seen.current = done;
  }, [done, router]);

  return (
    <div className="flex flex-col gap-6">
      <style>{GATE_CSS}</style>
      <BatchProgress batch={state.batch} />
      <div className="theme-dark grid grid-cols-1 gap-6 rounded-card bg-canvas p-5 text-ink lg:grid-cols-2">
        <HijackControls />
        <div aria-live="polite">
          <Gate pass={latestHijack(state.stage)} />
        </div>
      </div>
    </div>
  );
}

function BatchProgress({ batch }: { batch: BatchLive }) {
  const total = BATCH_ORDER.length;
  const live = batch.batch !== null && !batchDone(batch);
  const pct = Math.round((batch.finished / total) * 100);
  return (
    <Card as="section" aria-live="polite" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Batch progress</h2>
          <p className="text-xs text-ink-3">
            {batch.batch === null
              ? "Live from the event stream. Press Run batch to watch all four cards go through the lock."
              : live
                ? `Batch ${batch.batch} running: ${batch.finished} of ${total} cards scored`
                : `Batch ${batch.batch} finished: ${total} of ${total} cards scored`}
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <span>
            Caught <span className="font-semibold tabular-nums">{batch.batch === null ? "—" : batch.caught}</span>
          </span>
          <span>
            Broken{" "}
            <span className={cn("font-semibold tabular-nums", batch.batch !== null && (batch.broken === 0 ? "text-accent" : "text-stop"))}>
              {batch.batch === null ? "—" : batch.broken}
            </span>
          </span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={batch.finished} aria-valuemin={0} aria-valuemax={total}>
        <div className={cn("h-full rounded-full bg-accent transition-[width] duration-700", live && "suite-bar-live")} style={{ width: `${pct}%` }} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BATCH_ORDER.map((card) => {
          const status = cardStatus(batch, card);
          const c = batch.cards[card];
          const attack = TITLE.get(card);
          return (
            <li
              key={card}
              title={attack?.tries}
              className={cn("rounded-xl border p-3 transition-colors", status === "running" ? "border-review bg-review-soft/40" : status === "done" ? "border-accent/40" : "border-line")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{attack?.title ?? card}</span>
                <Badge tone={STATUS_TONE[status]} dot>
                  {STATUS_WORDS[status]}
                </Badge>
              </div>
              <p className="mt-2 text-xs tabular-nums text-ink-3">
                {c ? `${c.stopped} stopped · ${c.lines} lines replaced · ${c.routed} to a pharmacist · ${c.allowed} allowed` : "No presses yet"}
              </p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
