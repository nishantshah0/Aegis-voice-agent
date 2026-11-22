"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

type State = { kind: "idle" } | { kind: "posting" } | { kind: "started"; until: number } | { kind: "error"; message: string };

/**
 * Starts a run through an existing API route (the same driver, control layer and guard as
 * every call), then re-reads the saved results for a while so new numbers show up.
 * With no `url`, the button is shown disabled with the reason, never faked.
 */
export function RunButton({
  url,
  label = "Run",
  disabledReason,
  watchMs = 20_000,
  size = "sm",
  variant = "primary",
}: {
  url?: string;
  label?: string;
  disabledReason?: string;
  watchMs?: number;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "started") return;
    const tick = setInterval(() => {
      router.refresh();
      if (Date.now() > state.until) setState({ kind: "idle" });
    }, 2_000);
    return () => clearInterval(tick);
  }, [state, router]);

  async function run() {
    if (!url) return;
    setState({ kind: "posting" });
    try {
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        setState({ kind: "started", until: Date.now() + watchMs });
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setState({ kind: "error", message: body.error ?? `Request failed (${res.status})` });
    } catch {
      setState({ kind: "error", message: "Can't reach the server" });
    }
  }

  const busy = state.kind === "posting" || state.kind === "started";
  return (
    <span className="flex flex-col items-end gap-1">
      <Button size={size} variant={variant} disabled={!url || busy} onClick={() => void run()} title={!url ? disabledReason : undefined}>
        {busy && <span aria-hidden className="size-1.5 rounded-full bg-current suite-pulse" />}
        {state.kind === "posting" ? "Starting…" : state.kind === "started" ? "Running…" : label}
      </Button>
      {(state.kind === "error" || (!url && disabledReason)) && (
        <span role={state.kind === "error" ? "alert" : undefined} className="max-w-64 text-right text-xs text-ink-3">
          {state.kind === "error" ? state.message : disabledReason}
        </span>
      )}
    </span>
  );
}

/** Re-reads the page's saved results every few seconds while a run is still writing them. */
export function AutoRefresh({ active, everyMs = 5_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(tick);
  }, [active, everyMs, router]);
  return null;
}
