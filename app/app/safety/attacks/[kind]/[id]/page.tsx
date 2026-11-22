import { Suspense } from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, SkeletonRows } from "@/components/ui";
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
  try {
    file = obj(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return <p className="mt-6 text-sm text-ink-2">No saved attack call here.</p>;
  }
  const record = (Array.isArray(file.record) ? file.record : []).map(parseEntry);
  const score = obj(file.score);
  const caught = kind === "hijack" ? num(score.caught) : num(file.caught);
  const brokenList = kind === "hijack" ? [] : (Array.isArray(file.broken) ? file.broken : []).map(obj);
  const broken = kind === "hijack" ? num(score.broken) : brokenList.length;
  const checks = (Array.isArray(score.checks) ? score.checks : []).map(obj).map((c) => ({ id: String(c.id ?? ""), passed: c.passed === true, violation: c.violation === true }));
  const attempt: AttemptData = {
    n: 1,
    callId: String(file.callId ?? record[0]?.seq ?? ""),
    file: shortPath(path),
    record,
    chainIntact: chainIntact(record),
    score: { n: 1, callId: String(file.callId ?? ""), passed: broken === 0, caught, broken, checks, manualReview: [] },
  };
  const title = kind === "hijack" ? (STAGE_ATTACKS.find((s) => s.id === b)?.title ?? b) : String(file.tactic ?? "Overnight attack").replace(/_/g, " ");

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{kind === "hijack" ? "Hijacked AI · batch " + a : "Overnight red team · night " + a.slice(0, 10)}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] capitalize">{title}</h1>
        </div>
        <span className="flex gap-2">
          <Badge tone="review">{`${caught} caught`}</Badge>
          <Badge tone={broken ? "stop" : "accent"} dot>{`${broken} broken`}</Badge>
        </span>
      </div>
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
