import { readFile } from "node:fs/promises";
import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { USAGE_LOG } from "@/lib/agent/usage";
import { Badge, Card, Eyebrow, LaneBadge, RuleTag, StatTile, Table, TableEmpty, Td, Th, THead, Tr, type Tone } from "@/components/ui";
import { describeAgent, getDriver, getStore } from "@/app/api/_lib/runtime";
import { callsOverview, parseUsage, type CallSummary, type PressOutcome, type TimingSource } from "./calls";
import { LiveRefresh } from "./LiveRefresh";

const OUTCOME_TONE: Record<PressOutcome, Tone> = { allowed: "accent", routed: "review", refused: "stop", flagged: "quick" };
const label = (s: string) => s.replace(/_/g, " ");
const ms = (v?: number) => (v === undefined ? "–" : `${Math.round(v)} ms`);
const usd = (v: number) => `$${v.toFixed(4)}`;
const tokens = (v: number) => v.toLocaleString("en-CA");

function CallCard({ call, open }: { call: CallSummary; open: boolean }) {
  return (
    <Card as="article" className="text-sm">
      <details open={open}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-3">{call.callId}</span>
          <Badge>{call.direction}</Badge>
          <Badge tone={call.state === "ended" ? "neutral" : "accent"} dot={call.state !== "ended"}>
            {label(call.state)}
          </Badge>
          {call.patient && <span className="font-medium">{call.patient}</span>}
          <span className="text-ink-3">
            {call.presses.length} presses · {call.blocked.length} blocked lines · {call.transcript.length} lines
          </span>
        </summary>

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <section>
            <Eyebrow>Buttons pressed</Eyebrow>
            {call.presses.length === 0 && <p className="mt-2 text-ink-3">None.</p>}
            <ul className="mt-2 space-y-1.5">
              {call.presses.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span>{label(p.button)}</span>
                  <Badge tone={OUTCOME_TONE[p.outcome]}>{p.outcome}</Badge>
                  {p.ruleIds.map((id) => (
                    <RuleTag key={id}>{id}</RuleTag>
                  ))}
                  {p.lane && <LaneBadge lane={p.lane} />}
                </li>
              ))}
            </ul>

            <Eyebrow className="mt-5">Lines the speech guard blocked</Eyebrow>
            {call.blocked.length === 0 && <p className="mt-2 text-ink-3">None.</p>}
            <ul className="mt-2 space-y-2">
              {call.blocked.map((b, i) => (
                <li key={i}>
                  <RuleTag>{b.rule}</RuleTag> <span className="text-stop line-through">{b.original}</span>
                  <span className="block text-ink-3">Said instead: {b.replacement}</span>
                </li>
              ))}
            </ul>

            <Eyebrow className="mt-5">Turn timing (server side)</Eyebrow>
            {call.timing ? (
              <p className="mt-2 text-ink-2">
                {call.timing.turns} turns · first model text {ms(call.timing.medianFirstModelTextMs)} · first guarded sentence {ms(call.timing.medianFirstGuardedMs)} (medians)
              </p>
            ) : (
              <p className="mt-2 text-ink-3">No timing: this call didn&apos;t run on the real agent in this server.</p>
            )}
            <p className="mt-2 text-xs text-ink-3">{call.record.entries} record entries for this call.</p>
          </section>

          <section>
            <Eyebrow>Transcript</Eyebrow>
            {call.transcript.length === 0 && <p className="mt-2 text-ink-3">Nothing said yet.</p>}
            <ol className="mt-2 space-y-1.5">
              {call.transcript.map((l, i) => (
                <li key={i}>
                  <span className="text-ink-3">{l.who === "agent" ? "Agent" : "Caller"}:</span>{" "}
                  {l.blocked ? (
                    <>
                      <span className="line-through">{l.text}</span> <RuleTag>{l.blocked}</RuleTag>
                    </>
                  ) : (
                    l.text
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </details>
    </Card>
  );
}

// 2.9b. Signed out: a sign-in prompt only (calls carry patient detail).
export async function Calls() {
  await connection(); // Live data: never prerender.
  if (!(await getApprover())) {
    return (
      <Card className="mt-6 text-sm text-ink-2">
        <a href={AUTH_ROUTES.login} className="font-medium text-accent underline">
          Sign in
        </a>{" "}
        as a pharmacist or reviewer to see the voice agent&apos;s calls.
      </Card>
    );
  }
  const driver = getDriver();
  // Role 1's real driver keeps per-turn timing (1.6); the contract's fake has none.
  const timings = "turnTimings" in driver ? (driver as TimingSource) : undefined;
  const [overview, log] = await Promise.all([callsOverview(getStore(), { driver: timings }), readFile(USAGE_LOG, "utf8").catch(() => "")]);
  const usage = parseUsage(log);
  const agent = describeAgent();
  const models = Object.entries(usage.byModel);
  const totalCost = models.reduce((sum, [, m]) => sum + m.costUsd, 0);
  const totalModelCalls = models.reduce((sum, [, m]) => sum + m.modelCalls, 0);

  return (
    <>
      <LiveRefresh />
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatTile label="Calls" value={overview.calls.length} />
        <StatTile label="Automatic" value={overview.lanes.automatic} tone="accent" />
        <StatTile label="Quick check" value={overview.lanes.quick_check} tone="quick" />
        <StatTile label="Review" value={overview.lanes.review} tone="review" />
        <StatTile label="Model calls (log)" value={totalModelCalls} />
        <StatTile label="Cost (log)" value={usd(totalCost)} />
      </section>

      <Card className="mt-6 text-sm">
        <Eyebrow>Agent on this server</Eyebrow>
        <p className="mt-2">
          {agent.kind === "fake" ? "The contract's fake driver (no model)." : `${agent.kind === "agent-sdk" ? "Claude Agent SDK" : "Messages API"}, ${agent.model}`}
        </p>
        <Eyebrow className="mt-4">Record chain</Eyebrow>
        {overview.chain.verified ? (
          <p className="mt-2">
            <Badge tone="accent" dot>
              Record chain verified
            </Badge>{" "}
            {overview.chain.entries} entries
            {overview.chain.headHash && <span className="font-mono text-xs text-ink-3"> · head {overview.chain.headHash.slice(0, 12)}…</span>}
          </p>
        ) : (
          <p className="mt-2">
            <Badge tone="stop" dot>
              Record chain broken
            </Badge>{" "}
            at entry {overview.chain.brokenAt}
          </p>
        )}
      </Card>

      <section className="mt-6" data-testid="usage">
        <Eyebrow>Tokens and cost, from {USAGE_LOG}</Eyebrow>
        <div className="mt-2">
          {models.length === 0 ? (
            <TableEmpty>No Agent SDK usage logged yet.</TableEmpty>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Model</Th>
                  <Th>Turns</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Cache read / write</Th>
                  <Th>Cost</Th>
                </tr>
              </THead>
              <tbody>
                {models.map(([model, m]) => (
                  <Tr key={model}>
                    <Td className="font-mono text-ink">{model}</Td>
                    <Td>{m.turns}</Td>
                    <Td>{tokens(m.inputTokens)}</Td>
                    <Td>{tokens(m.outputTokens)}</Td>
                    <Td>
                      {tokens(m.cacheReadTokens)} / {tokens(m.cacheWriteTokens)}
                    </Td>
                    <Td>{usd(m.costUsd)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-3">Totals since the log began. Call ids restart after each demo reset, so usage isn&apos;t split per call.</p>
      </section>

      <section className="mt-6 space-y-3" data-testid="calls">
        {overview.calls.length === 0 ? (
          <Card className="text-sm text-ink-3">No calls yet. Run the daily check or call in from the phone.</Card>
        ) : (
          overview.calls.map((call, i) => <CallCard key={call.callId} call={call} open={i === 0} />)
        )}
      </section>
    </>
  );
}
