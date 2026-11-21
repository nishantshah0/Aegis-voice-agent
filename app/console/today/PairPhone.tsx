"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

// Staff pair the demo phone to a patient (Trail #19): pick the patient, then open the
// one-time link on that phone within 10 minutes. Only that phone can then answer the
// patient's outbound calls.
export function PairPhone({ patients }: { patients: { id: string; name: string }[] }) {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  async function pair() {
    setError("");
    setLink("");
    const res = await fetch("/api/phone/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) return setError(body.error ?? `Failed (${res.status})`);
    setLink(new URL(body.url, window.location.origin).toString());
  }

  return (
    <section className="mt-10 rounded-card border border-line bg-surface p-5 text-sm shadow-card">
      <h2 className="font-semibold tracking-[-0.01em]">Pair a patient&apos;s phone</h2>
      <p className="mt-1 text-ink-3">Only the paired phone can answer that patient&apos;s calls.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Patient"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className="h-8 rounded-full border border-line-strong bg-surface px-3 text-[13px]"
        >
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={pair} className={buttonClass("secondary", "sm")}>
          Make pairing link
        </button>
      </div>
      {link && (
        <p className="mt-3 break-all rounded-xl bg-sunken p-3 text-ink-2">
          Open this on the patient&apos;s phone within 10 minutes (it works once): <code>{link}</code>
        </p>
      )}
      {error && (
        <p className="mt-3 text-stop" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
