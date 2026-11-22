"use client";

import { useEffect, useState } from "react";

/** "N of 60 model calls this hour", from the shared usage log every live run paces on. */
export function ArenaUsage() {
  const [usage, setUsage] = useState<{ used: number; perHour: number } | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/arena/live", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { usage?: { used: number; perHour: number } } | null) => b?.usage && setUsage(b.usage))
        .catch(() => {});
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!usage) return null;
  const full = usage.used >= usage.perHour;
  return (
    <span className={full ? "text-sm text-stop" : "text-sm text-ink-2"} title="Every live run on this server paces on the same hourly log">
      <span className="font-semibold tabular-nums">{usage.used}</span> of {usage.perHour} model calls this hour
    </span>
  );
}
