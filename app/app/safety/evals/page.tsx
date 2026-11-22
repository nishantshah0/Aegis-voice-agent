import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, Skeleton, SkeletonRows, Sparkline, When, cn, linkClass } from "@/components/ui";
import { SignInCard, signedIn } from "../SignedIn";
import { readEvals, readHammerChart, type Layer, type LayerKey } from "./evals";
import { FINDINGS, REPO, commitUrl, trailUrl } from "./findings";

export const metadata = { title: "Evaluations · Safety suite · Aegis" };

const fmt = (n: number) => n.toLocaleString("en-US");
const code = (path: string) => `${REPO}/blob/main/${path}`;

export default function EvalsPage() {
  return (
    <>
      <PageHeader
        title="Evaluations"
        description="Review the latest saved result for each test layer. Every result keeps its run date, source, scope, and next step together."
        actions={
          <a href={code("docs/EVALS.md")} className={linkClass}>
            Scoring method →
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
    <Card as="section" id={`layer-${rung.key}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{n}</span>
        <h2 className="min-w-0 flex-1 text-[20px] leading-tight">{rung.title}</h2>
        {l ? (
          <Badge tone={l.broken === 0 ? "accent" : "stop"} dot>
            {l.broken === 0 ? "No rules broken" : `${fmt(l.broken)} broken`}
          </Badge>
        ) : (
          <Badge tone="neutral">{layer.savedAt ? "Saved files · no score" : "No saved run"}</Badge>
        )}
      </div>

      {l ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span>Latest result <When iso={l.at} /></span>
            <span>{layer.runs} saved run{layer.runs === 1 ? "" : "s"} in this layer</span>
            {l.path && <code className="font-mono" title={l.path}>{l.path}</code>}
          </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {l.figures.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-sunken/40 px-3 py-2">
              <dt className="text-[11px] text-ink-3">{label}</dt>
              <dd className="text-base font-semibold tabular-nums">{typeof value === "number" ? fmt(value) : value}</dd>
            </div>
          ))}
        </dl>
        {rung.key === "hammer" ? (
          <Suspense fallback={null}><HammerHistory layer={layer} /></Suspense>
        ) : <HistoryChart layer={layer} />}
        <Link href={l.href} className={linkClass}>
          Open {rung.title.toLowerCase()} results →
        </Link>
        </>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 text-sm text-ink-2">
          <p className="max-w-2xl">
            {layer.savedAt ? <>Saved files found <When iso={layer.savedAt} />; no scored result is available.</> : rung.noRun}
          </p>
          <Link href={rung.key === "scenarios" ? "/app/safety/scenarios" : rung.key === "hijack" ? "/app/safety/attacks" : "/app/safety/overnight"} className={linkClass}>
            Open workspace →
          </Link>
        </div>
      )}

      <details className="border-t border-line pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink-2">What this layer checks</summary>
        <div className="mt-2 max-w-3xl text-ink-3">
          <p>{rung.proves}</p>
          <p className="mt-2"><span className="font-medium text-ink-2">How it&apos;s scored: </span>{rung.scored}</p>
        </div>
      </details>
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
  const { layers, crossModel } = await readEvals();
  const needsAttention: { title: string; at: string; broken: number; href: string; path?: string }[] = LADDER.flatMap((rung) => {
    const latest = layers[rung.key].latest;
    return latest && latest.broken > 0 ? [{ title: rung.title, at: latest.at, broken: latest.broken, href: latest.href, path: latest.path }] : [];
  });
  if (crossModel && crossModel.broken > 0) {
    needsAttention.push({ title: "Cross-model red team", at: crossModel.at, broken: crossModel.broken, href: "#cross-model-run", path: crossModel.path });
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {needsAttention.length > 0 ? (
        <Card className="border-stop/50" aria-labelledby="evals-attention-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Eyebrow>Actionable exceptions</Eyebrow>
              <h2 id="evals-attention-title" className="mt-1 text-xl font-semibold">Needs attention</h2>
              <p className="mt-1 text-sm text-ink-2">These are separate latest saved runs. Open the matching suite to trace its failed checks.</p>
            </div>
            <Badge tone="stop" dot>{needsAttention.length} saved result{needsAttention.length === 1 ? "" : "s"}</Badge>
          </div>
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
            {needsAttention.map((item) => (
              <li key={item.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Link href={item.href} className="min-w-40 flex-1 font-medium text-ink hover:text-accent">{item.title}</Link>
                <Badge tone="stop">{fmt(item.broken)} broken</Badge>
                <span className="text-xs text-ink-3"><When iso={item.at} /></span>
                {item.path && <code className="max-w-full break-all font-mono text-[11px] text-ink-3">{item.path}</code>}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            {LADDER.some((rung) => layers[rung.key].latest)
              ? "No broken rules appear in the latest saved runs. Each test layer below has its own date, scope, and result."
              : "No scored runs are saved yet. Choose a test workspace below to start one."}
          </p>
          <Badge tone="neutral">Independent test runs</Badge>
        </Card>
      )}

      {crossModel && (
        <Card id="cross-model-run" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Eyebrow>Separate saved run · cross-model red team</Eyebrow>
              <h2 className="mt-1 text-lg font-semibold">Attacker-model breakdown</h2>
              <p className="mt-1 text-xs text-ink-3">{crossModel.families.length} model families · {fmt(crossModel.calls)} calls · {fmt(crossModel.caught)} caught · {fmt(crossModel.gaps)} gaps · saved <When iso={crossModel.at} /></p>
            </div>
            <Badge tone={crossModel.broken === 0 ? "accent" : "stop"} dot>
              {crossModel.broken === 0 ? "No rules broken" : `${fmt(crossModel.broken)} broken`}
            </Badge>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-sunken/40 text-xs text-ink-3">
                <tr><th className="px-3 py-2 font-medium">Attacker model</th><th className="px-3 py-2 font-medium">Calls</th><th className="px-3 py-2 font-medium">Caught</th><th className="px-3 py-2 font-medium">Broken</th><th className="px-3 py-2 font-medium">Run ID</th></tr>
              </thead>
              <tbody>
                {crossModel.byAttacker.map((a) => (
                  <tr key={a.runId} className="border-t border-line">
                    <td className="px-3 py-2">{a.attackerModel}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(a.calls)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(a.caught)}</td>
                    <td className={cn("px-3 py-2 tabular-nums", a.broken > 0 && "font-semibold text-stop")}>{fmt(a.broken)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.runId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-3">Source: <code className="break-all font-mono">{crossModel.path}</code></p>
        </Card>
      )}

      <section>
        <Eyebrow>Latest results by test layer</Eyebrow>
        <p className="mt-1 text-sm text-ink-2">Runs stay separate because each suite has its own cases and scoring scope.</p>
        <ol className="mt-3 flex flex-col gap-3">
          {LADDER.map((rung, i) => (
            <li key={rung.key}>
              <RungCard n={i + 1} rung={rung} layer={layers[rung.key]} />
            </li>
          ))}
        </ol>
      </section>

      <details className="rounded-card border border-line bg-surface p-5">
        <summary className="cursor-pointer font-medium">Scoring method and past fixes</summary>
        <div className="mt-5 flex flex-col gap-8">
          <section>
            <Eyebrow>How the scores are produced</Eyebrow>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {TRUST.map((t) => (
                <Card key={t.title} className="flex flex-col gap-2">
                  <h3 className="text-[15px] font-semibold">{t.title}</h3>
                  <p className="text-sm text-ink-2">{t.body}</p>
                  <span className="mt-auto flex flex-wrap items-center justify-between gap-2">
                    <a href={t.link.href} className={cn(linkClass, "font-mono text-xs")}>{t.link.label}</a>
                    {t.page && <Link href={t.page.href} className={cn(linkClass, "text-xs")}>{t.page.label}</Link>}
                  </span>
                </Card>
              ))}
            </div>
          </section>
          <section>
            <Eyebrow>Past fixes from saved tests</Eyebrow>
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
                      <a key={c.sha} href={commitUrl(c.sha)} title={c.label} className="rounded-md border border-line-strong px-1.5 font-mono text-[11px] leading-5 text-ink-2 hover:border-accent hover:text-ink">{c.sha}</a>
                    ))}
                    <a href={f.link.href} className={cn(linkClass, "text-xs")}>{f.link.label}</a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}
