import { PageHeader, buttonClass } from "@/components/ui";
import { StageView } from "@/app/stage/StageView";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Live gate · Safety suite · Aegis" };

// The live gate: the stage view itself (app/stage), imported, not copied. Driven only by
// /api/events, so every press and blocked line here is a real one.
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
        <StageView embedded="gate" />
      </div>
    </SuiteGate>
  );
}
