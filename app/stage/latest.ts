import { connection } from "next/server";
import type { StreamEvent } from "@/lib/contract";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { latestCallEvents } from "./replay";

export type LatestCall = { callId: string | null; events: StreamEvent[]; signedIn: boolean };

/**
 * The latest real call for whoever is looking, the same way /api/events decides: signed-in
 * staff get everything, anyone else the public view. If the store can't be read, the stage
 * simply starts empty and waits for the next call.
 */
export async function loadLatestCall(): Promise<LatestCall> {
  // The record changes with every call: never prerender this.
  await connection();
  const signedIn = (await getApprover().catch(() => null)) !== null;
  try {
    const store = getStore();
    const [record, queue] = await Promise.all([store.listRecord(), store.queue()]);
    return { ...latestCallEvents(record, queue, signedIn ? { kind: "staff" } : { kind: "public" }), signedIn };
  } catch (error) {
    console.error("stage: could not load the latest call", error);
    return { callId: null, events: [], signedIn };
  }
}
