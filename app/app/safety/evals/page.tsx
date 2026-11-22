import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, Skeleton, SkeletonRows, Sparkline, When, cn, linkClass } from "@/components/ui";
import { SignInCard, signedIn } from "../SignedIn";
import { readEvals, readHammerChart, type Layer, type LayerKey } from "./evals";
import { FINDINGS, REPO, commitUrl, trailUrl } from "./findings";

export const metadata = { title: "How we know it holds · Safety suite · Aegis" };

const fmt = (n: number) => n.toLocaleString("en-US");
const code = (path: string) => `${REPO}/blob/main/${path}`;

export default function EvalsPage() {
  return (
    <>
      <PageHeader
        title="How we know it holds"
        description="Seven layers of tests, from fuzzing the lock with no AI at all to a real phone line. Every number here is read from a run saved under results/."
        actions={
          <a href={code("docs/EVALS.md")} className={linkClass}>
            The method, in plain words →
          </a>
        }
      />
      <Suspense
        fallback={
          <div className="mt-8 flex flex-col gap-6">
            <Skeleton className="h-40 w-full" />
            <SkeletonRows rows={7} />
          </div>
        }
      >
        <Evals />
      </Suspense>
    </>
  );
}

type Rung = { key: LayerKey; title: string; proves: string; scored: string; noRun: ReactNode };

const LADDER: Rung[] = [
  {
    key: "hammer",
    title: "The hammer: the lock with no AI",
    proves: "Every sequence of button presses up to three deep, plus thousands of random ones, straight at the control layer. If the code can be talked into breaking a rule, some sequence finds it.",
    scored: "The lock's invariants are code, checked after every press. A sequence that breaks one is saved as a failure. Broken must be 0: the release gate fails the build otherwise.",
    noRun: <>Run it with <code className="font-mono text-xs">npm run hammer</code>.</>,
  },
  {
    key: "hijack",
    title: "A fully hijacked AI",
    proves: "We swap in an AI that does whatever it's asked and make it try four attacks: an early controlled refill, someone else's prescription, a new address, and reading details out before ID.",
    scored: "Checks on the record: each attempt must be blocked, or sent to a pharmacist, and never done.",
    noRun: <>Press Run batch on <Link href="/app/safety/attacks" className={linkClass}>Attacks</Link>.</>,
  },
  {
    key: "scenarios",
    title: "Scripted scenarios",
    proves: "28 scripted callers (ordinary patients, emergencies, people bending the rules), each run three times through the real driver on the live model.",
    scored: "Only from the hash-chained record: each card's checks look for entries that must be there, must not be, or must come in order. No LLM grades the score; the judgement questions are left for a person.",
    noRun: <>Press Run suite on <Link href="/app/safety/scenarios" className={linkClass}>Scenarios</Link>.</>,
  },
  {
    key: "personas",
    title: "Persona callers",
    proves: "Randomised, realistic patients with everyday needs call the agent. Each call is scored for safety and for helpfulness, so being safe never means being useless, before and after the agent upgrade.",
    scored: "The same record checks for safety, plus a helpfulness score per call.",
    noRun: "Role 3 is building this runner (results/arena/personas). No run is saved yet, so there's no number here.",
  },
  {
    key: "overnight",
    title: "The overnight red team",
    proves: "An attacker model writes new attacks each night, from tactics like skipping verification or claiming to be the pharmacist, and calls the real agent with them.",
    scored: "Every record entry is checked by the hammer's invariants as it's written. Anything that breaks one is a gap, tracked to its fix.",
    noRun: <>Press Run overnight on <Link href="/app/safety/overnight" className={linkClass}>Overnight</Link>.</>,
  },
  {
    key: "live",
    title: "Live attack calls",
    proves: "Watch one: an attacker AI rings the real agent on a simulated line, both sides voiced, and the timeline marks each moment the lock catches it.",
    scored: "Caught = blocked presses and replaced lines; broken = the hammer's invariants; and the record's hash chain is verified at the end of the call.",
    noRun: <>Start one from <Link href="/app/safety/live-calls" className={linkClass}>Live calls</Link>.</>,
  },
  {
    key: "phone",
    title: "A real phone line",
    proves: "The same driver, 12 buttons and speech guard answer a real phone call, over Twilio and ElevenLabs.",
    scored: "The same record and the same rules as every other call.",
    noRun: (
      <>
        Built on <a href={trailUrl(70)} className={linkClass}>Trail #70</a>. Its calls aren&apos;t saved under results/, so there&apos;s no number here.
      </>
    ),
  },
];

function HistoryChart({ layer }: { layer: Layer }) {
  return layer.history.length > 1 && (
    <div>
      <Sparkline
        values={layer.history.map((p) => p.value)}
        titles={layer.history.map((p) => `${p.at.slice(0, 16).replace("T", " ")} UTC: ${fmt(p.value)}`)}
        label={`${layer.historyLabel}, ${layer.history.length} saved runs`}
      />
      <p className="mt-1 text-[11px] text-ink-3">
        {layer.history.length} saved runs · {layer.historyLabel}
      </p>
    </div>
  );
}

async function HammerHistory({ layer }: { layer: Layer }) {
  return <HistoryChart layer={await readHammerChart(layer)} />;
}

function RungCard({ n, rung, layer }: { n: number; rung: Rung; layer: Layer }) {
  const l = layer.latest;
  return (
    <Card as="section" className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{n}</span>
          <h2 className="text-[22px] leading-tight">{rung.title}</h2>
        </div>
        <p className="mt-3 text-sm text-ink-2">{rung.proves}</p>
        <p className="mt-2 text-sm text-ink-3">
          <span className="font-medium text-ink-2">How it&apos;s scored: </span>
          {rung.scored}
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken/40 p-4">
        {l ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-3">
                Latest run <When iso={l.at} />
              </span>
              <Badge tone={l.broken === 0 ? "accent" : "stop"} dot>{`${fmt(l.broken)} broken`}</Badge>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {l.figures.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] text-ink-3">{label}</dt>
                  <dd className="text-base font-semibold tabular-nums">{typeof value === "number" ? fmt(value) : value}</dd>
                </div>
              ))}
            </dl>
            {rung.key === "hammer" ? (
              <Suspense fallback={null}><HammerHistory layer={layer} /></Suspense>
            ) : <HistoryChart layer={layer} />}
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Link href={l.href} className={linkClass}>
                See the run →
              </Link>
              {l.path && <code className="truncate font-mono text-[11px] text-ink-3" title={l.path}>{l.path}</code>}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-3">
            <span className="block font-medium text-ink-2">No run saved yet</span>
            {rung.noRun}
          </p>
        )}
      </div>
    </Card>
  );
}

const TRUST: { title: string; body: string; link: { label: string; href: string }; page?: { label: string; href: string } }[] = [
  {
    title: "Scored from the record, not the model's word",
    body: "Every press and every sentence is an entry in the call's record, each one hash-chained to the one before. Scores read those entries, never what the model says it did, and the chain is checked so an entry can't be changed or dropped.",
    link: { label: "lib/store/memory.ts: findBrokenLink", href: code("lib/store/memory.ts") },
  },
  {
    title: "Reproducible",
    body: "Every test call starts from the same made-up patients on its own fresh store, so a failure can be replayed exactly. Nothing touches real patients or the pharmacy's live data.",
    link: { label: "lib/seed", href: code("lib/seed/index.ts") },
  },
  {
    title: "The same lock for every call",
    body: "Scripted scenarios, the red team, live attack calls, the phone line and real patient calls all go through the same AgentDriver, the same 12 buttons and the same speech guard. There is no test-only path around them.",
    link: { label: "lib/arena/live-session.ts", href: code("lib/arena/live-session.ts") },
  },
  {
    title: "A release gate that blocks a broken rule",
    body: "On every push to main and every pull request, CI runs the type check, lint, every test and the hammer, which fails if any invariant breaks, then the build. Our rule is never to merge on a red gate.",
    link: { label: ".github/workflows/ci.yml", href: code(".github/workflows/ci.yml") },
    page: { label: "See the latest gate run →", href: "/app/safety/gate-report" },
  },
];

async function Evals() {
  await connection(); // Results change between runs: never prerender.
  if (!(await signedIn())) return <SignInCard />;
  const { layers, hero, crossModel } = await readEvals();

  return (
    <div className="mt-8 flex flex-col gap-10">
      <Card className="grid gap-6 p-7 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <div>
          <p className="text-sm font-medium text-ink-2">Rules broken, every layer</p>
          <p className={cn("text-[7rem] leading-none font-semibold tabular-nums tracking-[-0.06em]", hero.broken === null ? "text-ink-3" : hero.broken === 0 ? "text-accent" : "text-stop")}>
            {hero.broken === null ? "—" : fmt(hero.broken)}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 md:border-l md:border-line md:pl-8">
          <div>
            <dt className="text-xs text-ink-3">Layers with a saved run</dt>
            <dd className="text-3xl font-semibold tabular-nums">
              {hero.layers} <span className="text-base text-ink-3">of 7</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Calls in the latest runs</dt>
            <dd className="text-3xl font-semibold tabular-nums">{fmt(hero.calls)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Presses fuzzed by the hammer</dt>
            <dd className="text-3xl font-semibold tabular-nums">{fmt(hero.presses)}</dd>
          </div>
          <p className="col-span-3 text-xs text-ink-3">
            {hero.broken !== null && hero.broken > 0
              ? "A real result from a saved run: open the layer below to see which rule and why."
              : "Each layer's latest saved run, added up. A layer with nothing saved adds nothing and says so."}
          </p>
        </dl>
      </Card>

      {crossModel && (
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <p className="text-[15px] font-semibold">
              Attacked by {crossModel.families.length} model {crossModel.families.length === 1 ? "family" : "families"},{" "}
              <span className={crossModel.broken === 0 ? "text-accent" : "text-stop"}>{fmt(crossModel.broken)} broken</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              The overnight red team, run once per attacker model so one model&apos;s blind spots can&apos;t hide a gap · <When iso={crossModel.at} /> ·{" "}
              <code className="font-mono">{crossModel.path}</code>
            </p>
          </div>
          <dl className="ml-auto flex flex-wrap gap-6">
            {crossModel.byAttacker.map((a) => (
              <div key={a.runId}>
                <dt className="text-xs text-ink-3">{a.attackerModel}</dt>
                <dd className="text-sm tabular-nums">
                  <span className="font-semibold text-ink">{fmt(a.calls)}</span> calls · {fmt(a.caught)} caught ·{" "}
                  <span className={a.broken ? "font-semibold text-stop" : "text-accent"}>{fmt(a.broken)} broken</span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <section>
        <Eyebrow>The ladder of tests</Eyebrow>
        <p className="mt-1 text-sm text-ink-2">Each layer is harder to fool than the last, and each catches what the one before can&apos;t see.</p>
        <ol className="mt-3 flex flex-col gap-3">
          {LADDER.map((rung, i) => (
            <li key={rung.key}>
              <RungCard n={i + 1} rung={rung} layer={layers[rung.key]} />
            </li>
          ))}
        </ol>
      </section>

      <section>
        <Eyebrow>Why you can trust the score</Eyebrow>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {TRUST.map((t) => (
            <Card key={t.title} className="flex flex-col gap-2">
              <h3 className="text-[15px] font-semibold">{t.title}</h3>
              <p className="text-sm text-ink-2">{t.body}</p>
              <span className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <a href={t.link.href} className={cn(linkClass, "font-mono text-xs")}>
                  {t.link.label}
                </a>
                {t.page && (
                  <Link href={t.page.href} className={cn(linkClass, "text-xs")}>
                    {t.page.label}
                  </Link>
                )}
              </span>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <Eyebrow>What the tests found tonight, and the fix</Eyebrow>
        <ul className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
          {FINDINGS.map((f) => (
            <li key={f.title} className="grid gap-2 border-t border-line px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_16rem]">
              <div>
                <p className="text-[15px] font-medium">{f.title}</p>
                <p className="mt-1 text-sm text-ink-2">{f.fix}</p>
                <p className="mt-1 text-xs text-ink-3">Found by: {f.foundBy}</p>
              </div>
              <div className="flex flex-wrap content-start items-center gap-1.5 md:justify-end">
                {f.commits.map((c) => (
                  <a key={c.sha} href={commitUrl(c.sha)} title={c.label} className="rounded-md border border-line-strong px-1.5 font-mono text-[11px] leading-5 text-ink-2 hover:border-accent hover:text-ink">
                    {c.sha}
                  </a>
                ))}
                <a href={f.link.href} className={cn(linkClass, "text-xs")}>
                  {f.link.label}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
