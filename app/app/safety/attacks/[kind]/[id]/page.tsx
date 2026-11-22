import { replayTickets } from "@/app/api/_lib/replay-tickets";
import { Suspense } from "react";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, SkeletonRows, When } from "@/components/ui";
import { resultsDir } from "@/app/console/overnight/results";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { parseEntry, shortPath, type Entry } from "../../../data";
import { SignInCard, signedIn } from "../../../SignedIn";
import { AttemptView, type AttemptData } from "../../../scenarios/[id]/AttemptView";

export const metadata = { title: "Attack · Safety suite · Aegis" };

// One saved attack's call, from results/: a hijack card in a batch (hijack/<batch>~<card>) or
// an overnight attack call (overnight/<night>~<n>). The transcript, where the lock caught it,
// and the hash-chained record.
export async function generateStaticParams() {
  return [{ kind: "hijack", id: "none" }];
}

const SAFE = /^[A-Za-z0-9._-]+$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const chainIntact = (record: Entry[]) => record.every((e, i) => i === 0 || e.prevHash === record[i - 1]?.hash);

export default function AttackPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  return (
    <>
      <Link href="/app/safety/attacks" className="text-sm text-ink-2 hover:text-ink">
        ← Attack library
      </Link>
      <Suspense fallback={<SkeletonRows rows={6} className="mt-6" />}>
        <AttackCall params={params} />
      </Suspense>
    </>
  );
}

async function AttackCall({ params }: { params: Promise<{ kind: string; id: string }> }) {
  await connection();
  if (!(await signedIn())) return <SignInCard />;
  const { kind, id } = await params;
  const [a, b] = decodeURIComponent(id).split("~");
  if (!a || !b || !SAFE.test(a) || !SAFE.test(b) || (kind !== "hijack" && kind !== "overnight")) return <p className="mt-6 text-sm text-ink-2">No saved attack call here.</p>;

  const path = kind === "hijack" ? join(resultsDir(), "hijack", a, `${b}.json`) : join(resultsDir(), "arena", "overnight", a, "calls", `${b}.json`);
  let file: Record<string, unknown>;
  let savedAt: string;
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    file = obj(JSON.parse(text));
    savedAt = String(file.ranAt ?? file.startedAt ?? info.mtime.toISOString());
  } catch {
    return <p className="mt-6 text-sm text-ink-2">No saved attack call here.</p>;
  }
  const record = (Array.isArray(file.record) ? file.record : []).map(parseEntry);
  const score = obj(file.score);
  const caught = kind === "hijack" ? num(score.caught) : num(file.caught);
  const brokenList = kind === "hijack" ? [] : (Array.isArray(file.broken) ? file.broken : []).map(obj);
  const broken = kind === "hijack" ? num(score.broken) : brokenList.length;
  const checks = (Array.isArray(score.checks) ? score.checks : []).map(obj).map((c) => ({ id: String(c.id ?? ""), passed: c.passed === true, violation: c.violation === true }));
  const scored = kind === "hijack" ? typeof score.automatedPassed === "boolean" : Array.isArray(file.broken) && typeof file.caught === "number";
  const passed = kind === "hijack" ? score.automatedPassed === true : broken === 0;
  const attempt: AttemptData = {
    n: 1,
    callId: String(file.callId ?? (record[0] as Entry & { callId?: string } | undefined)?.callId ?? ""),
    file: shortPath(path),
    record,
    tickets: replayTickets(path, record),
    chainIntact: chainIntact(record),
    score: scored ? { n: 1, callId: String(file.callId ?? ""), passed, caught, broken, checks, manualReview: [] } : null,
  };
  const title = kind === "hijack" ? (STAGE_ATTACKS.find((s) => s.id === b)?.title ?? b) : String(file.tactic ?? "Overnight attack").replace(/_/g, " ");
  const attacker = String(file.attackerModel ?? file.model ?? "Not recorded");
  const callId = String(file.callId ?? (record[0] as Entry & { callId?: string } | undefined)?.callId ?? "Not recorded");

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{kind === "hijack" ? "Scripted attack · batch " + a : "Overnight red team · run " + a}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] capitalize">{title}</h1>
        </div>
        {scored && <span className="flex flex-wrap gap-2">
          <Badge tone={passed ? "accent" : "stop"} dot>{passed ? "Checks passed" : "Review failure"}</Badge>
          <Badge tone="review">{`${caught} caught`}</Badge>
          <Badge tone={broken ? "stop" : "neutral"}>{`${broken} broken`}</Badge>
        </span>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 rounded-card border border-line bg-surface px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-ink-3">Saved at</dt><dd className="mt-1"><When iso={savedAt} /></dd></div>
        <div><dt className="text-xs text-ink-3">Attacker model</dt><dd className="mt-1 break-words">{attacker}</dd></div>
        <div><dt className="text-xs text-ink-3">Call ID</dt><dd className="mt-1 font-mono text-xs">{callId}</dd></div>
        <div><dt className="text-xs text-ink-3">Evidence file</dt><dd className="mt-1 break-all font-mono text-xs">{shortPath(path)}</dd></div>
      </dl>
      {brokenList.length > 0 && (
        <ul className="rounded-card border border-stop/50 bg-stop-soft px-5 py-3 text-sm text-stop">
          {brokenList.map((x, i) => (
            <li key={i}>
              {String(x.rule ?? "")}: {String(x.detail ?? "")}
            </li>
          ))}
        </ul>
      )}
      <AttemptView attempts={[attempt]} />
    </div>
  );
}
