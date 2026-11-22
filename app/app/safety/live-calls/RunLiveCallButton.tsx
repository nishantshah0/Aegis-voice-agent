"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { getAttacker } from "../AttackerPicker";

export type LiveSourceInput =
  | { kind: "card" | "scenario" | "custom"; id: string }
  | { kind: "new"; attack: Record<string, unknown>; save?: boolean };

/** Starts a live attack call (POST /api/arena/live) and opens its call view. */
export async function startLiveCall(source: LiveSourceInput): Promise<{ id: string } | { error: string }> {
  try {
    const res = await fetch("/api/arena/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, model: getAttacker() }) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.ok && body.id) return { id: body.id };
    return { error: body.error ?? `Request failed (${res.status})` };
  } catch {
    return { error: "Can't reach the server" };
  }
}

export const callHref = (id: string) => `/app/safety/calls/${encodeURIComponent(id)}`;

export function RunLiveCallButton({ source, label = "Run live call", size = "sm", variant = "secondary" }: { source: LiveSourceInput; label?: string; size?: "sm" | "md"; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const started = await startLiveCall(source);
    if ("id" in started) {
      router.push(callHref(started.id));
      return;
    }
    setError(started.error);
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size={size} variant={variant} disabled={busy} onClick={() => void run()}>
        <span aria-hidden>☎</span>
        {busy ? "Dialling…" : label}
      </Button>
      {error && (
        <span role="alert" className="max-w-64 text-right text-xs text-stop">
          {error}
        </span>
      )}
    </span>
  );
}
