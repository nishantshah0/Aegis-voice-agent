import type { QueueItem, Store } from "@/lib/contract";
import { itemDetail, laneTotals, type ItemDetail, type LaneTotals } from "@/app/console/today/detail";

// What Today shows a signed-in pharmacist: lane totals, what's waiting (Review first,
// then Quick check, oldest first), what went through on its own, and recent decisions.

const LANE_ORDER: Record<QueueItem["lane"], number> = { review: 0, quick_check: 1, automatic: 2 };
const RECENT = 10;

export type TodayItem = ItemDetail & { createdAt: string; decidedAt?: string };
export type Today = { appointments: { slotId: string; label: string; patient: string }[]; totals: LaneTotals; waiting: TodayItem[]; automatic: TodayItem[]; decided: TodayItem[] };

const at = (i: QueueItem) => Date.parse(i.decidedAt ?? i.createdAt);

export async function today(store: Store): Promise<Today> {
  const [items, totals, bookings, policy, now] = await Promise.all([
    store.queue(), laneTotals(store), store.listAppointments(), store.policy(), store.now(),
  ]);
  const upcoming = (policy.appointmentSlots ?? []).filter((slot) => Date.parse(slot.start) > Date.parse(now));
  const appointments = [];
  for (const slot of upcoming.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const reservation = bookings.find((b) => b.slotId === slot.id);
    if (!reservation) continue;
    const patient = await store.getPatient(reservation.patientId);
    appointments.push({ slotId: slot.id, label: slot.label, patient: patient ? `${patient.firstName[0]}.${patient.lastName[0]}.` : "Unknown patient" });
  }
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
  return { appointments, totals, waiting: w, automatic: a, decided: d };
}
