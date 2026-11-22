"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/contract";
import { listenToEvents, type EventConnection } from "@/lib/events/client";
import type { StreamEvent } from "@/lib/events/types";
import { cn } from "@/components/ui";

const MOVES = ["line", "press", "blocked_line", "queue", "phone"];

function callOf(event: StreamEvent): string | undefined {
  if (event.type === "queue") return event.item.callId;
  return "callId" in event ? event.callId : undefined;
}

export function useLiveUpdates(callId?: string, onQueueItem?: (item: QueueItem) => void) {
  const router = useRouter();
  const [pulse, setPulse] = useState(0);
  const [connection, setConnection] = useState<EventConnection>("connecting");
  const [syncing, startSync] = useTransition();
  const receiveItem = useEffectEvent((item: QueueItem) => onQueueItem?.(item));
  // A router refresh must not tear down the subscription that requested it.
  const refresh = useEffectEvent(() => router.refresh());

  useEffect(() => {
    let previous: EventConnection = "connecting";
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = listenToEvents((event) => {
      if (!MOVES.includes(event.type)) return;
      if (callId && callOf(event) !== callId) return;
      if (event.type === "queue") receiveItem(event.item);
      setPulse((n) => n + 1);
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        refresh();
      }, 1000);
    }, undefined, (state) => {
      if (state === "connected" && previous === "recovering") {
        clearTimeout(pending);
        pending = undefined;
        startSync(() => refresh());
      }
      previous = state;
      setConnection(state);
    });
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, [callId]);
  return { pulse, connection: connection === "connected" && syncing ? "recovering" as const : connection };
}

const CONNECTION_LABEL: Record<EventConnection, string> = {
  connecting: "Connecting to live updates",
  connected: "Live",
  recovering: "Recovering live updates",
};

export function LiveStatus({ connection, pulse, className }: { connection: EventConnection; pulse: number; className?: string }) {
  const connected = connection === "connected";
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs text-ink-3", className)}>
      <span aria-hidden className="relative flex size-2">
        {connected && pulse > 0 && (
          <span key={pulse} className="absolute inline-flex size-full rounded-full bg-accent opacity-75 motion-safe:animate-ping [animation-iteration-count:1]" />
        )}
        <span className={cn("relative size-2 rounded-full", connected ? "bg-accent" : "bg-quick")} />
      </span>
      {CONNECTION_LABEL[connection]}
    </span>
  );
}

/** Re-reads the page when a call moves, at most once a second. */
export function Live({ callId, className }: { callId?: string; className?: string }) {
  const status = useLiveUpdates(callId);
  return <LiveStatus {...status} className={className} />;
}
