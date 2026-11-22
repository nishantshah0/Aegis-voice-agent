import type { Store } from "@/lib/contract";
import { summarizeCalls, type TimingSource } from "@/app/console/calls/calls";
import { toRow, type History } from "./rows";
import { historyCallIds } from "@/app/api/_lib/demo-history";

// Server side: every call from the record, newest first, with the queue items it made.
export async function history(store: Store, { driver }: { driver?: TimingSource } = {}): Promise<History> {
  const [record, queue] = await Promise.all([store.listRecord(), store.queue()]);
  const scripted = historyCallIds(record);
  const lanes = { automatic: 0, quick_check: 0, review: 0 };
  for (const item of queue) lanes[item.lane]++;
  const overview = await summarizeCalls(store, record, lanes, driver);
  const queueByCall = Map.groupBy(queue, (item) => item.callId);
  return {
    rows: overview.calls.map((call) => toRow(call, queueByCall.get(call.callId) ?? [])),
    chain: overview.chain,
    scripted: [...scripted],
    callerTurns: Object.fromEntries(overview.calls.map((c) => [c.callId, c.transcript.filter((l) => l.who === "caller").length])),
  };
}
