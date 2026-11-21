"use client";

import { useEffect, useState } from "react";
import { Button, cn } from "@/components/ui";

const STEP_MS = 700;

/** Plays a saved failure back one step at a time. Every step comes from the saved file. */
export function Replay({ steps }: { steps: string[] }) {
  const [shown, setShown] = useState(steps.length);
  const playing = shown < steps.length;

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, shown]);

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={() => setShown(0)} disabled={playing}>
        {playing ? "Replaying…" : "Replay"}
      </Button>
      <ol className="mt-4 space-y-2 font-mono text-[13px]">
        {steps.slice(0, shown).map((step, i) => (
          <li
            key={i}
            className={cn("rounded-md border border-line px-3 py-2 transition-opacity", playing && i === shown - 1 ? "border-review bg-review-soft" : "bg-sunken")}
          >
            <span className="mr-2 text-ink-3">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
