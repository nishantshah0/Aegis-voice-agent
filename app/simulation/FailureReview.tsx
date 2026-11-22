"use client";

import { useRef, useState } from "react";
import { Badge, Card, chipClass } from "@/components/ui";
import type { CallPlayback } from "./call-playback";
import { LiveTestPlayer, SavedCallPlayer } from "./SimulationCallPlayer";
import type { EvidenceLine, FailureCase } from "./failure-cases";

function Evidence({ lines }: { lines: EvidenceLine[] }) {
  return (
    <ol className="divide-y divide-line rounded-lg border border-line">
      {lines.map(line => (
        <li key={line.line} value={line.line} className="grid grid-cols-[2.5rem_1fr] gap-2 px-3 py-2 text-sm sm:grid-cols-[2.5rem_5rem_1fr]">
          <span className="font-mono text-xs tabular-nums text-ink-3" aria-label={`Line ${line.line}`}>#{line.line}</span>
          <span className="font-medium capitalize">{line.speaker}</span>
          <span className="col-start-2 sm:col-start-3">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function FailureReview({ cases }: { cases: FailureCase[] }) {
  const [selected, setSelected] = useState(0);
  const audible = useRef<CallPlayback | null>(null);
  function focus(player: CallPlayback) {
    if (audible.current !== player) audible.current?.pause();
    audible.current = player;
  }
  const item = cases[selected];
  if (!item) return null;
  return (
    <section id="failures" aria-labelledby="failure-heading" className="mt-6 scroll-mt-4">
      <Card>
        <h2 id="failure-heading" className="text-2xl font-semibold">Where calls went wrong</h2>
        <div role="group" aria-label="Select a failure to review" className="my-4 flex flex-wrap gap-2">
          {cases.map((example, i) => <button type="button" key={example.id} onClick={() => setSelected(i)}
            aria-controls="failure-detail" aria-pressed={i === selected} className={chipClass(i === selected)}>
            {example.label}
          </button>)}
        </div>
        <article id="failure-detail" key={item.id} aria-labelledby="failure-title" className="border-t border-line pt-4">
          <Badge tone="review">{item.source}</Badge>
          <h3 id="failure-title" className="mt-3 text-xl font-semibold">{item.title}</h3>
          <div className="my-4 grid gap-4 md:grid-cols-2">
            <div><h4 className="text-sm font-semibold">Expected response</h4><p className="mt-1 text-sm text-ink-2">{item.expected}</p></div>
            <div><h4 className="text-sm font-semibold">What happened</h4><p className="mt-1 text-sm text-ink-2">{item.observed}</p></div>
          </div>
          <h4 className="mb-2 text-sm font-semibold">{item.location}</h4>
          <Evidence lines={item.evidence} />
          <p className="mt-3 text-sm"><strong>Verdict</strong> · {item.result}</p>
          <SavedCallPlayer item={item} focus={focus} />
          <p className="mt-3 text-xs text-ink-3">{item.audioNote}</p>
        </article>
        <LiveTestPlayer focus={focus} preferred={item.id} />
      </Card>
    </section>
  );
}
