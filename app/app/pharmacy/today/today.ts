import type { QueueItem, Store } from "@/lib/contract";
import { itemDetail, laneTotals, type ItemDetail, type LaneTotals } from "@/app/console/today/detail";

// What Today shows a signed-in pharmacist: lane totals, what's waiting (Review first,
// then Quick check, oldest first), what went through on its own, and recent decisions.

const LANE_ORDER: Record<QueueItem["lane"], number> = { review: 0, quick_check: 1, automatic: 2 };
const RECENT = 10;

export type TodayItem = ItemDetail & { createdAt: string; decidedAt?: string };
export type Today = { totals: LaneTotals; waiting: TodayItem[]; automatic: TodayItem[]; decided: TodayItem[] };

const at = (i: QueueItem) => Date.parse(i.decidedAt ?? i.createdAt);

export async function today(store: Store): Promise<Today> {
  const [items, totals] = await Promise.all([store.queue(), laneTotals(store)]);
  const view = (item: QueueItem) =>
    itemDetail(store, item).then((d): TodayItem => ({ ...d, createdAt: item.createdAt, ...(item.decidedAt ? { decidedAt: item.decidedAt } : {}) }));
  const waiting = items
    .filter((i) => i.status === "open" && i.lane !== "automatic")
    .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const automatic = items.filter((i) => i.lane === "automatic").sort((a, b) => at(b) - at(a)).slice(0, RECENT);
  const decided = items
    .filter((i) => i.status !== "open" && i.lane !== "automatic")
    .sort((a, b) => at(b) - at(a))
    .slice(0, RECENT);
  const [w, a, d] = await Promise.all([Promise.all(waiting.map(view)), Promise.all(automatic.map(view)), Promise.all(decided.map(view))]);
  return { totals, waiting: w, automatic: a, decided: d };
}
