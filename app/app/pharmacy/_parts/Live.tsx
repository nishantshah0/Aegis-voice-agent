"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToEvents } from "@/lib/events/client";
import type { StreamEvent } from "@/lib/events/types";
import { cn } from "@/components/ui";

const MOVES = ["line", "press", "blocked_line", "queue", "phone"];

function callOf(event: StreamEvent): string | undefined {
  if (event.type === "queue") return event.item.callId;
  return "callId" in event ? event.callId : undefined;
}

/**
 * Re-reads the page when a call moves (at most once a second), and shows a small
 * "Live" dot that flashes on each event. Pass `callId` to follow one call only.
 */
export function Live({ callId, className }: { callId?: string; className?: string }) {
  const router = useRouter();
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = listenToEvents((event) => {
      if (!MOVES.includes(event.type)) return;
      if (callId && callOf(event) !== callId) return;
      setPulse((n) => n + 1);
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        router.refresh();
      }, 1000);
    });
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, [router, callId]);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-3", className)} title="Updates from the event stream as calls move">
      <span aria-hidden className="relative flex size-2">
        <span key={pulse} className={cn("absolute inline-flex size-full rounded-full bg-accent opacity-75", pulse > 0 && "animate-ping [animation-iteration-count:1]")} />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      Live
    </span>
  );
}
