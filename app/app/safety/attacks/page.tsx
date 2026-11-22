import { PageHeader } from "@/components/ui";
import { StageView } from "@/app/stage/StageView";

export const metadata = { title: "Attacks · Safety suite · Aegis" };

export default function AttacksPage() {
  return (
    <>
      <PageHeader
        title="Attacks"
        description="Swap in a compromised AI that does whatever it's asked, then watch each thing it tries hit the gate. Run every card as a batch for the counters."
      />
      <div className="mt-8">
        <StageView embedded="attacks" />
      </div>
    </>
  );
}
