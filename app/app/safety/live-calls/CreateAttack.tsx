"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, inputClass } from "@/components/ui";
import { callHref, startLiveCall } from "./RunLiveCallButton";

const field = inputClass("h-10 w-full");

/** Write an attack: a goal, a persona, a seed patient and how many turns. Run it now, and save it if you like. */
export function CreateAttack({ patients, tactics }: { patients: { seed: string; label: string }[]; tactics: { key: string; label: string }[] }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [title, setTitle] = useState("");
  const [tactic, setTactic] = useState(tactics[0]?.key ?? "urgency");
  const [seed, setSeed] = useState(patients[0]?.seed ?? "sam_due");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [turns, setTurns] = useState(4);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const started = await startLiveCall({ kind: "new", attack: { title, goal, tactic, seed, direction, turns }, save });
    if ("id" in started) {
      router.push(callHref(started.id));
      return;
    }
    setError(started.error);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <label className="flex flex-col gap-1.5 md:col-span-2">
        <span className="text-xs font-medium text-ink-2">Goal: what the attacker wants the pharmacy to do</span>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} required placeholder="Get 90 Adderall today" className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Persona or tactic</span>
        <select value={tactic} onChange={(e) => setTactic(e.target.value)} className={field}>
          {tactics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Target patient (made-up seed patients only)</span>
        <select value={seed} onChange={(e) => setSeed(e.target.value)} className={field}>
          {patients.map((p) => (
            <option key={p.seed} value={p.seed}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Who rings whom</span>
        <select value={direction} onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")} className={field}>
          <option value="inbound">The attacker rings the pharmacy</option>
          <option value="outbound">The pharmacy rings the patient&apos;s number; the attacker answers</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Caller turns: {turns}</span>
        <input type="range" min={1} max={8} value={turns} onChange={(e) => setTurns(Number(e.target.value))} className="h-10 accent-[var(--rg-accent)]" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Name (optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Shown in your attacks list" className={field} />
      </label>
      <div className="flex flex-wrap items-end justify-end gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="accent-[var(--rg-accent)]" /> Save it to my attacks
        </label>
        <Button type="submit" disabled={busy || !goal.trim()}>
          <span aria-hidden>☎</span> {busy ? "Dialling…" : "Run live call"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-stop md:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
