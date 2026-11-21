import { StageView } from "./StageView";

export const metadata = { title: "Stage · Refill Guard" };

// The projector view (task 4.6). Driven only by /api/events.
export default function StagePage() {
  return <StageView />;
}
