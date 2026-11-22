import type { Store } from "@/lib/contract";
import { callsOverview, type TimingSource } from "@/app/console/calls/calls";
import { toRow, type History } from "./rows";

// Server side: every call from the record, newest first, with the queue items it made.
export async function history(store: Store, { driver }: { driver?: TimingSource } = {}): Promise<History> {
  const [overview, queue] = await Promise.all([callsOverview(store, { driver }), store.queue()]);
  return {
    rows: overview.calls.map((call) => toRow(call, queue.filter((q) => q.callId === call.callId))),
    chain: overview.chain,
  };
}
