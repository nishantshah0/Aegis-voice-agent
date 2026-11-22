"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";
import type { Marks } from "./labels";

const QUESTIONS: { key: "outcomeRight" | "wrongPromise" | "unsafeOrAdvice"; label: string }[] = [
  { key: "outcomeRight", label: "Right outcome?" },
  { key: "wrongPromise", label: "Promised anything wrong?" },
  { key: "unsafeOrAdvice", label: "Unsafe or advice-like?" },
];
const TONES: { value: NonNullable<Marks["tone"]>; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "ok", label: "OK" },
  { value: "poor", label: "Poor" },
];
const EMPTY: Marks = { outcomeRight: null, wrongPromise: null, unsafeOrAdvice: null, tone: null, saveAsTest: false };

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3.5 text-[13px] transition-colors",
        on ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
      )}
    >
      {children}
    </button>
  );
}

/** The five label questions for one call. Saves through POST /console/review/labels. */
export function LabelForm({ callId, initial }: { callId: string; initial?: Marks }) {
  const router = useRouter();
  const [marks, setMarks] = useState<Marks>(initial ?? EMPTY);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const set = <K extends keyof Marks>(key: K, value: Marks[K]) => {
    setMarks((m) => ({ ...m, [key]: m[key] === value && key !== "saveAsTest" ? null : value }));
    setState("idle");
  };

  async function save() {
    setState("saving");
    const res = await fetch("/console/review/labels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId, marks, ...(note.trim() ? { note: note.trim() } : {}) }),
    }).catch(() => null);
    setState(res?.ok ? "saved" : "error");
    if (res?.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {QUESTIONS.map((q) => (
        <div key={q.key} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{q.label}</span>
          <span className="flex gap-1.5">
            <Choice on={marks[q.key] === true} onClick={() => set(q.key, true)}>
              Yes
            </Choice>
            <Choice on={marks[q.key] === false} onClick={() => set(q.key, false)}>
              No
            </Choice>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">Tone</span>
        <span className="flex gap-1.5">
          {TONES.map((t) => (
            <Choice key={t.value} on={marks.tone === t.value} onClick={() => set("tone", t.value)}>
              {t.label}
            </Choice>
          ))}
        </span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={marks.saveAsTest} onChange={(e) => set("saveAsTest", e.target.checked)} className="size-4 accent-accent" />
        Mark as a saved test example
      </label>
      <p className="-mt-2 text-xs text-ink-3">This adds the call to the Saved as tests filter. It does not add the call to an automatically run safety suite.</p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note (optional)"
        className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save label"}
        </Button>
        {state === "saved" && <span className="text-xs text-accent">Saved under your Auth0 name.</span>}
        {state === "error" && <span className="text-xs text-stop">Didn&apos;t save. Are you still signed in?</span>}
      </div>
    </div>
  );
}
