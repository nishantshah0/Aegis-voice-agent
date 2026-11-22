import { Suspense } from "react";
import { StageView } from "./StageView";
import { loadLatestCall } from "./latest";

export const metadata = { title: "Stage · Aegis" };

// The projector view (task 4.6). Opens on the latest real call from the record, then follows
// /api/events live.
export default function StagePage() {
  return (
    <Suspense fallback={<StageView />}>
      <LatestStage />
    </Suspense>
  );
}

async function LatestStage() {
  const { events, signedIn } = await loadLatestCall();
  return <StageView initial={events} signedIn={signedIn} />;
}
