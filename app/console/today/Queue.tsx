import { connection } from "next/server";
import type { QueueItem } from "@/lib/contract";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { itemDetail, laneTotals } from "./detail";
import { EventFeed } from "./EventFeed";
import { LaneTotals } from "./LaneTotals";
import { QueueList } from "./QueueList";

const LANE_ORDER: Record<QueueItem["lane"], number> = { review: 0, quick_check: 1, automatic: 2 };
const RECENT = 10;

// Lane totals, then what a person has to decide (Review first), then recent decisions.
export async function Queue() {
  await connection(); // Live data: never prerender.
  const store = getStore();
  const [approver, totals] = await Promise.all([getApprover(), laneTotals(store)]);
  // Signed out: counts and a sign-in prompt only. No item detail is ever built (Trail #10).
  if (!approver) {
    return (
      <>
        <LaneTotals totals={totals} />
        <p className="mt-6 text-sm text-neutral-600">
          <a href={AUTH_ROUTES.login} className="underline">
            Sign in
          </a>{" "}
          as a pharmacist or reviewer to see what&apos;s waiting.
        </p>
      </>
    );
  }
  const items = await store.queue();
  const waiting = items
    .filter((item) => item.status === "open" && item.lane !== "automatic")
    .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const decided = items
    .filter((item) => item.status !== "open")
    .sort((a, b) => Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt))
    .slice(0, RECENT);
  const [waitingDetails, decidedDetails] = await Promise.all([
    Promise.all(waiting.map((item) => itemDetail(store, item))),
    Promise.all(decided.map((item) => itemDetail(store, item))),
  ]);
  return (
    <>
      <QueueList totals={totals} waiting={waitingDetails} decided={decidedDetails} canDecide={approver.role === "pharmacist"} signedIn />
      <details className="mt-8">
        <summary className="cursor-pointer text-sm text-neutral-500">Live event feed (for the team)</summary>
        <EventFeed />
      </details>
    </>
  );
}
