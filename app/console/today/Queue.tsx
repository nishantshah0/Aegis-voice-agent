import { connection } from "next/server";
import type { QueueItem } from "@/lib/contract";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { QueueList, type QueueRow } from "./QueueList";

const LANE_ORDER: Record<QueueItem["lane"], number> = { review: 0, quick_check: 1, automatic: 2 };

async function toRow(item: QueueItem): Promise<QueueRow> {
  const store = getStore();
  const [patient, rx] = await Promise.all([
    store.getPatient(item.patientId),
    item.rxId ? store.getPrescription(item.rxId) : Promise.resolve(undefined),
  ]);
  return {
    id: item.id,
    lane: item.lane,
    kind: item.kind,
    initials: patient ? `${patient.firstName[0]}.${patient.lastName[0]}.` : "Unknown patient",
    drug: rx ? `${rx.drug} ${rx.strength}` : undefined,
    ruleIds: item.ruleIds,
    signals: item.signals,
    notes: item.notes.map((n) => n.text),
  };
}

// The open items a person has to decide: Review first, then Quick check.
export async function Queue() {
  await connection(); // Live data: never prerender.
  const [approver, items] = await Promise.all([getApprover(), getStore().queue()]);
  const open = items
    .filter((item) => item.status === "open" && item.lane !== "automatic")
    .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane]);
  const rows = await Promise.all(open.map(toRow));
  return <QueueList rows={rows} canDecide={approver?.role === "pharmacist"} signedIn={approver !== null} />;
}
