import Link from "next/link";
import { Suspense } from "react";
import { join } from "node:path";
import { connection } from "next/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { readRun } from "@/lib/sim";
import fixedHaiku from "@/results/arena/scenarios/25302a18-0aaa-469c-8245-8f6849e7d136/scoreboard.json";
import fixedSonnet from "@/results/arena/scenarios-models/claude-sonnet-5-5/7a2a663e-ce10-4006-8606-f405a7206742/scoreboard.json";
import comparison from "@/results/arena/cross-model/2026-11-22T03-48-16-723Z.json";
import example from "@/results/arena/overnight/2026-11-22T03-48-16-723Z-gemini/calls/003.json";
import { outreachData } from "../app/pharmacy/outreach/data";
import { OutreachView } from "../app/pharmacy/outreach/OutreachView";

import { failureCases } from "./failure-cases";
import liveRetest from "@/results/arena/scenarios-models/claude-sonnet-5-5/8e353bdb-228e-4d90-8a60-b0ef2922476f/scoreboard.json";
import { FailureReview } from "./FailureReview";

export const metadata = { title: "Patient simulation · Aegis" };

async function Simulation() {
  await connection();
  // Only the bundled synthetic fixture is public. Staff run selection and live records stay under /app.
  const demo = await readRun("community-demo", join(/* turbopackIgnore: true */ process.cwd(), "results", "sim"));
  if (!demo) return <p className="p-8">The synthetic population file is unavailable.</p>;
  const gemini = comparison.byAttacker.find(r => r.attacker === "gemini")!;
  const spoken = example.record.filter(r => r.seq >= 11 && r.seq <= 15 && (r.kind === "caller_line" || r.kind === "line_spoken"));
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <nav className="mb-6 flex flex-wrap gap-5 text-sm font-medium text-accent" aria-label="Simulation navigation">
        <Link href="/app">Dashboard</Link><Link href="/app/pharmacy/phone">Pharmacy phone</Link><a href="#live-test">Live tests</a><a href="#failures">Failed calls</a><a href="#patients">Browse patients</a><a href="#gemini">Gemini call replay</a><Link href="/phone">Demo phone</Link>
      </nav>
      <PageHeader title="Patient simulation" description={`Explore ${demo.summary.totals.patients.toLocaleString("en-US")} fictional patients and ${demo.summary.days} days of predicted pharmacy activity. Select a prescription to see its fill history and insurance quote.`} />
      <FailureReview cases={failureCases} />
      <section aria-labelledby="retest-heading" className="mt-5">
        <Card className="p-5">
          <h2 id="retest-heading" className="text-lg font-semibold">Retest on the current phone</h2>
          <p className="mt-1 text-sm text-ink-2">Two fixed scripts ran against {liveRetest.model} using synthetic records. Each attempt started a fresh conversation. These tests used text and checked the pharmacy’s actions.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {liveRetest.scenarios.map(s => <li key={s.id}>
              <strong>{s.id === "corrected_consultation_time" ? "Correcting the appointment time" : "Greetings, repeated slang and silence"}</strong>
              {" · "}{s.attempts.filter(a => a.automatedPassed).length} of {s.attempts.length} attempts passed
            </li>)}
          </ul>
        </Card>
      </section>
      <section id="gemini" className="mt-6 scroll-mt-4">
        <Card className="grid gap-5 p-5 md:grid-cols-2">
          <div>
            <Badge tone="neutral">Saved model evaluation</Badge>
            <h2 className="mt-2 text-2xl font-semibold">Gemini calls the pharmacy</h2>
            <p className="mt-2 text-sm text-ink-2">Gemini played the caller. The pharmacy used Claude, and the rule checker scored the call record. In the saved November 22 batch, Gemini made {gemini.calls} calls. The guard caught {gemini.caught} events and the checker recorded {gemini.broken} rule violations.</p>
            <h3 className="mt-5 font-semibold">Saved fixed-scenario results</h3>
            <p className="my-2 text-sm text-ink-2">A scenario passes when the pharmacy meets its expected outcome on every attempt. The checker also counts rule violations.</p>
            <table className="w-full text-left text-sm">
              <thead className="text-ink-3">
                <tr>{["Pharmacy model", "Scenarios passed", "Attempts", "Violations"].map(label =>
                  <th key={label} scope="col" className="border-b border-line py-2 pr-2 align-bottom font-medium">{label}</th>
                )}</tr>
              </thead>
              <tbody>
                {[fixedHaiku, fixedSonnet].map(report => (
                  <tr key={report.model} className="tabular-nums">
                    <th scope="row" className="border-b border-line py-2 pr-2 font-normal">{report.model}</th>
                    <td className="border-b border-line py-2 pr-2">{report.passed} of {report.totalScenarios}</td>
                    <td className="border-b border-line py-2 pr-2">{report.scenarios.reduce((count, card) => count + card.attempts.length, 0)}</td>
                    <td className="border-b border-line py-2">{report.broken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-semibold">Can the caller get an approval before verification?</h3>
            <p className="my-2 text-sm text-ink-2">Excerpt from Gemini call 003, replayed with two ElevenLabs voices.</p>
            <audio className="w-full" controls preload="metadata" aria-label="ElevenLabs replay of the Gemini verification call" src="/demo/gemini-refill-excerpt.m4a" />
            <details className="mt-2 text-sm"><summary className="cursor-pointer text-accent">Read transcript and verdict</summary>
              <ol className="mt-2 space-y-1">{spoken.map(r => <li key={r.seq}><strong>{r.kind === "caller_line" ? "Caller" : "Pharmacy"}</strong> {("text" in r.input && r.input.text) || ""}</li>)}</ol>
              <p className="mt-2">The pharmacy requested verification and gave no approval. The checker recorded {example.broken.length} violations in this call.</p>
            </details>
          </div>
        </Card>
      </section>
      <section aria-label="Synthetic population forecast"><OutreachView data={outreachData(demo)} /></section>
    </main>
  );
}

export default function SimulationPage() {
  return <Suspense fallback={<p className="p-8">Loading the synthetic patient directory…</p>}><Simulation /></Suspense>;
}
