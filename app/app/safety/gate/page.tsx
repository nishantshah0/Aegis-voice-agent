import { Suspense } from "react";
import { PageHeader, buttonClass } from "@/components/ui";
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
        description="Every button the AI presses and every sentence it tries, checked in code as it happens."
        actions={
          <a href="/stage" target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            Open on the projector <span aria-hidden>↗</span>
          </a>
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
  const { events, signedIn } = await loadLatestCall();
  return <StageView embedded="gate" initial={events} signedIn={signedIn} />;
}
