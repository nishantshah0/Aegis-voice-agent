import { getStore } from "@/app/api/_lib/runtime";
import { describeCall } from "@/app/console/review/calls";
import { latestLabels, readLabels } from "@/app/console/review/labels";
import { getApprover } from "@/lib/auth/session";

export async function GET(_request: Request, { params }: RouteContext<"/api/review/call/[id]">) {
  const headers = { "Cache-Control": "private, no-store" };
  const approver = await getApprover();
  if (!approver) return Response.json({ error: "Sign in required" }, { status: 401, headers });

  const { id } = await params;
  const store = getStore();
  const [record, queue, labels] = await Promise.all([store.listRecord(id), store.queue(), readLabels()]);
  const call = record.length ? await describeCall(store, id, record, queue.filter((item) => item.callId === id)) : null;
  if (!call) return Response.json({ error: "Call not found" }, { status: 404, headers });
  const latest = latestLabels(labels).get(id) ?? [];
  return Response.json({ call, labels: latest, mine: latest.find((label) => label.by.id === approver.id) }, { headers });
}
