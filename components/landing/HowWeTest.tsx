import Link from "next/link";
import type { ReactNode } from "react";
import { getApprover } from "@/lib/auth/session";
import { hammerTotals, hijackBatch, overnightScore, suiteScore } from "./evidence";
import { Eyebrow } from "@/components/ui";

const EVALS_DOC = "https://github.com/nishantshah0/namereserve/blob/main/docs/EVALS.md";
const fmt = (n: number) => n.toLocaleString("en-US");

type Layer = { name: string; body: string; figure?: string };

// Every figure is read from results/ (see ./evidence); a layer with no saved run shows no
// number. Cached: the files only change when a run is saved and the site is rebuilt.
async function layers(): Promise<Layer[]> {
  "use cache";
  const hammer = hammerTotals();
  const [hijack, suite, night] = await Promise.all([hijackBatch(), suiteScore(), overnightScore()]);
  return [
    {
      name: "Fuzzing the lock",
      body: "No AI at all: every button sequence, pressed blind, checked after every press.",
      figure: `${fmt(hammer.broken)} broken · ${fmt(hammer.sequences)} sequences`,
    },
    {
      name: "A fully hijacked AI",
      body: "An AI that does whatever it's told, behind the same lock.",
      figure: hijack ? `${fmt(hijack.caught)} caught · ${fmt(hijack.broken)} broken` : undefined,
    },
    {
      name: "Scripted scenarios",
      body: "Ordinary patients, identity tricks, leaks and emergencies, three runs each.",
      figure: suite ? `${fmt(suite.passed)} of ${fmt(suite.total)} passed` : undefined,
    },
    {
      name: "An overnight red team",
      body: "An attacker plans calls while the pharmacy sleeps; the hammer's rules judge every entry.",
      figure: night ? `${fmt(night.calls)} calls · ${fmt(night.broken)} broken` : undefined,
    },
    { name: "Live attack calls", body: "Attacks against the real voice agent, through the same lock and record." },
    { name: "A real phone line", body: "The same agent on an actual phone number, not just the demo screen." },
  ];
}

/** Signed in: a link straight to the evals in the app. Signed out: nothing (the doc link stays). */
export async function EvalsAppLink() {
  const approver = await getApprover();
  if (!approver) return null;
  return (
    <Link href="/app/safety/evals" className="text-sm font-medium text-accent hover:underline">
      Open the evals →
    </Link>
  );
}

export async function HowWeTest({ appLink }: { appLink: ReactNode }) {
  const rows = await layers();
  return (
    <section id="testing" className="scroll-mt-16" aria-labelledby="testing-title">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>How we test it</Eyebrow>
            <h2 id="testing-title" className="mt-3 text-3xl font-medium tracking-[-0.04em] md:text-4xl">
              Six ways we try to break it, before anyone else does.
            </h2>
          </div>
          <div className="flex items-center gap-5">
            {appLink}
            <a href={EVALS_DOC} className="text-sm text-ink-2 hover:text-ink">
              How we test, in full ↗
            </a>
          </div>
        </div>
        <ol className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-6">
          {rows.map((l, i) => (
            <li key={l.name} className="flex flex-col bg-canvas p-5">
              <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="mt-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">{l.name}</span>
              <span className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{l.body}</span>
              {l.figure && <span className="mt-auto pt-4 font-mono text-xs text-accent">{l.figure}</span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
