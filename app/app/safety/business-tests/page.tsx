import { ButtonLink, Eyebrow, PageHeader } from "@/components/ui";
import { SuiteControl, WorkflowChecks } from "@/app/present/OperatorControls";
import { FailureReview } from "@/app/simulation/FailureReview";
import { failureCases } from "@/app/simulation/failure-cases";
import "@/app/present/page.css";

export const metadata = { title: "Business tests · Safety suite" };

export default function BusinessTests() {
  return <>
    <PageHeader title="Business tests" description="Run synthetic pharmacy workflows, then inspect the live results and saved call evidence."
      actions={<ButtonLink href="https://aegis-pharmacy-review.nishantshah2573.chatgpt.site" variant="secondary" size="sm">Entire benchmark</ButtonLink>} />
    <section className="mt-8" aria-labelledby="run-configuration-heading">
      <Eyebrow>Test configuration and run controls</Eyebrow>
      <h2 id="run-configuration-heading" className="mt-1 text-xl font-semibold tracking-tight">Choose a synthetic workflow</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">The scripted suite runs the tests you pick, persona, security, safety and task callers, one at a time through the real agent and lock; you hear each call as it happens. Workflow checks run separately against synthetic records.</p>
      <div className="workspace-controls mt-4 grid items-start gap-5 xl:grid-cols-2">
        <SuiteControl />
        <WorkflowChecks />
      </div>
    </section>
    <section className="mt-10" aria-labelledby="saved-evidence-heading">
      <Eyebrow>Saved synthetic evidence</Eyebrow>
      <h2 id="saved-evidence-heading" className="mt-1 text-xl font-semibold tracking-tight">Review a call example</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">These saved examples include their source and transcript excerpts. They are reference records, separate from results produced by a new run above.</p>
      <FailureReview cases={failureCases} />
    </section>
  </>;
}
