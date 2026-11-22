import { Suspense } from "react";
import { ButtonLink, PageHeader } from "@/components/ui";
import { loadLatestCall } from "@/app/stage/latest";
import { StageView } from "@/app/stage/StageView";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Live gate · Safety suite · Aegis" };

// The live gate: the stage view itself (app/stage), imported, not copied. It opens on the
// latest call from the record (AUDIT #12), then follows /api/events, so every press and
// blocked line here is a real one.
export default function GatePage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Live gate"
        description="Watch an active call’s buttons and speech checks as they happen. Saved typecheck, lint, test and build results are on Release gate."
        actions={
          <ButtonLink href="/stage" target="_blank" rel="noopener" variant="secondary" size="sm">
            Open on the projector <span aria-hidden>↗</span>
          </ButtonLink>
        }
      />
      <div className="mt-8">
        <Suspense fallback={<StageView embedded="gate" />}>
          <LatestGate />
        </Suspense>
      </div>
    </SuiteGate>
  );
}

async function LatestGate() {
  const { callId, events, signedIn } = await loadLatestCall();
  return <StageView embedded="gate" initial={events} lastCallId={callId} signedIn={signedIn} />;
}
