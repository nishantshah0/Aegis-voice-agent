import { PageHeader, buttonClass } from "@/components/ui";
import { StageView } from "@/app/stage/StageView";

export const metadata = { title: "Live gate · Safety suite · Aegis" };

export default function GatePage() {
  return (
    <>
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
    </>
  );
}
