import { connection } from "next/server";
import { Badge, Card, Eyebrow } from "@/components/ui";
import { readWhy } from "./whyExport";

const REPO = "https://github.com/nishantshah0/namereserve";

/** For each rule: the line of code that enforces it, and the commit and AI session behind it. */
export async function Why() {
  await connection();
  const why = await readWhy();
  if (!why) {
    return (
      <p className="mt-4 rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">
        No export yet. Run <span className="font-mono text-xs">scripts/why.ts</span> to write results/why/.
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-sm text-ink-3">
        From <span className="font-mono text-xs">entire why</span>, exported {new Date(why.generatedAt).toLocaleString()}.
        {why.missing.length > 0 && ` Missing: ${why.missing.join(", ")}.`}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {why.records.map((r) => (
          <Card key={r.id} as="article">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-ink">{r.title}</p>
              <Badge tone={r.status === "checkpoint" ? "accent" : "neutral"}>{r.status === "checkpoint" ? "AI session" : r.status}</Badge>
            </div>
            <a href={`${REPO}/blob/main/${r.file}#L${r.line}`} className="mt-1 block font-mono text-xs text-ink-3 hover:text-accent">
              {r.file}:{r.line}
            </a>
            {r.content && <pre className="mt-3 overflow-x-auto rounded-xl bg-sunken p-3 font-mono text-xs text-ink-2">{r.content}</pre>}
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {r.commit && (
                <>
                  <dt className="text-ink-3">Commit</dt>
                  <dd>
                    <a href={`${REPO}/commit/${r.commit}`} className="font-mono text-ink-2 hover:text-accent">
                      {r.commit}
                    </a>
                    {r.authorTime && <span className="text-ink-3"> · {new Date(r.authorTime).toLocaleString()}</span>}
                  </dd>
                </>
              )}
              {r.agent && (
                <>
                  <dt className="text-ink-3">Written by</dt>
                  <dd className="text-ink-2">
                    {r.agent}
                    {r.model && <span className="font-mono text-ink-3"> · {r.model}</span>}
                  </dd>
                </>
              )}
              {r.checkpointId && (
                <>
                  <dt className="text-ink-3">Checkpoint</dt>
                  <dd className="font-mono text-ink-3">{r.checkpointId}</dd>
                </>
              )}
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}

export function WhyHeading() {
  return (
    <div className="mt-12">
      <Eyebrow>Why each rule is there</Eyebrow>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">Every rule traced to its line, commit and AI session</h2>
    </div>
  );
}
