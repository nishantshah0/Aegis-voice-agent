import { ButtonLink, PageHeader } from "@/components/ui";
import { SuiteControl, WorkflowChecks } from "@/app/present/OperatorControls";
import { FailureReview } from "@/app/simulation/FailureReview";
import { failureCases } from "@/app/simulation/failure-cases";
import "@/app/present/page.css";

export const metadata = { title: "Business tests · Safety suite" };

export default function BusinessTests() {
  return <>
    <PageHeader title="Business tests" description="Run pharmacy workflows, listen to calls and inspect the verdicts."
      actions={<ButtonLink href="https://aegis-pharmacy-review.nishantshah2573.chatgpt.site" variant="secondary" size="sm">Entire benchmark</ButtonLink>} />
    <div className="workspace-controls mt-6 grid items-start gap-5 xl:grid-cols-2"><SuiteControl /><WorkflowChecks /></div>
    <FailureReview cases={failureCases} />
  </>;
}
