"use client";

import { useEffect, useState } from "react";
import { cn } from "./cn";
import { absoluteTime, relativeTime, shortTime } from "./time";

/**
 * A time, said the same way everywhere: relative in the text, the full time on hover.
 * `format="short"` prints "Nov 24, 10:00 AM" instead, for columns that compare rows.
 * Re-reads the clock every 30 s so "just now" moves on.
 */
export function When({ iso, format = "relative", className }: { iso?: string | null; format?: "relative" | "short"; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (format !== "relative") return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [format]);
  if (!iso) return <span className={cn("text-ink-3", className)}>—</span>;
  const text = format === "short" ? shortTime(iso) : relativeTime(iso, now);
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className={cn("whitespace-nowrap tabular-nums", className)} suppressHydrationWarning>
      {text}
    </time>
  );
}
