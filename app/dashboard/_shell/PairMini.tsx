"use client";

import { useState } from "react";
import { buttonClass, cn } from "@/components/ui";

// Pair the demo phone to a patient through the existing POST /api/phone/pair (Trail #19):
// the server checks who may, and the link works once, within 10 minutes.
export function PairMini({ patients, compact = false }: { patients: { id: string; name: string }[]; compact?: boolean }) {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function pair() {
    setError("");
    setLink("");
    setCopied(false);
    const res = await fetch("/api/phone/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId }) });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) return setError(body.error ?? `Failed (${res.status})`);
    setLink(new URL(body.url, window.location.origin).toString());
  }

  async function copy() {
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
  }

  return (
    <div className={cn("text-sm", compact ? "space-y-2" : "space-y-3")}>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={compact ? "pair-patient-mini" : "pair-patient"}>
          Patient
        </label>
        <select
          id={compact ? "pair-patient-mini" : "pair-patient"}
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-ink"
        >
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={pair} disabled={!patientId} className={buttonClass("secondary", "sm")}>
          Pair
        </button>
      </div>
      {link && (
        <div className="rounded-xl bg-sunken p-2.5">
          <p className="text-xs text-ink-3">Open on the patient&apos;s phone within 10 minutes. It works once.</p>
          <p className="mt-1 break-all font-mono text-[11px] text-ink-2">{link}</p>
          <button type="button" onClick={copy} className="mt-1.5 text-xs font-medium text-accent hover:underline">
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-stop">
          {error}
        </p>
      )}
    </div>
  );
}
