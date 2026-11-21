"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { listenToEvents } from "@/lib/events/client";

// Re-reads the page when a call moves (a line, a press, a blocked line, a queue change), at
// most once a second.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = listenToEvents((event) => {
      if (!["line", "press", "blocked_line", "queue", "phone"].includes(event.type) || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        router.refresh();
      }, 1000);
    });
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, [router]);
  return null;
}
