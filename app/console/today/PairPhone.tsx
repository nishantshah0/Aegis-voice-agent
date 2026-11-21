"use client";

import { useState } from "react";

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
    <section className="mt-6 rounded border border-neutral-300 p-3 text-sm">
      <h2 className="font-medium">Pair a patient&apos;s phone</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="Patient"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1"
        >
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={pair} className="rounded border border-neutral-400 px-3 py-1.5 hover:opacity-75">
          Make pairing link
        </button>
      </div>
      {link && (
        <p className="mt-2 break-all">
          Open this on the patient&apos;s phone within 10 minutes (it works once): <code>{link}</code>
        </p>
      )}
      {error && (
        <p className="mt-2 text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
