import { StageView } from "@/app/stage/StageView";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Live gate · Safety suite · Aegis" };

// The live gate: the stage view itself (app/stage), imported, not copied. Driven only by
// /api/events, so every press and blocked line here is a real one.
export default function LiveGatePage() {
  return (
    <SuiteGate>
      <div className="suite-embed -mx-5 overflow-hidden rounded-card md:mx-0">
        <StageView />
      </div>
    </SuiteGate>
  );
}
