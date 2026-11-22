import { relative } from "node:path";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, RuleTag, StatTile, Table, Td, Th, THead, TimelineStrip, Tr } from "@/components/ui";
import { getStore } from "@/app/api/_lib/runtime";
import { CORE_RULES } from "@/app/console/today/detail";
import { readRules } from "./rules";

const fmt = (n: number) => n.toLocaleString("en-US");
const when = (iso: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "time not recorded");

/** A rule's saved hammer result: how many saved failures broke an invariant that watches it. */
function HammerCell({ broken, invariants }: { broken: number | null; invariants: string[] }) {
  if (!invariants.length) return <span className="text-xs text-ink-3">No hammer invariant watches this</span>;
  return (
    <div className="flex flex-col gap-1">
      {broken === null ? <Badge>No run yet</Badge> : <Badge tone={broken === 0 ? "accent" : "stop"} dot>{`${fmt(broken)} broken`}</Badge>}
      <span className="text-xs text-ink-3" title={invariants.join("\n")}>
        {invariants.length === 1 ? invariants[0] : `${fmt(invariants.length)} invariants`}
      </span>
    </div>
  );
}

// The Rules tab: read only. Buttons and speech rules from lib/contract, hammer results
// from results/hammer-latest.json. Nothing on this page can change a rule.
export async function RuleBook() {
  await connection(); // The hammer file changes between runs: never prerender.
  const [{ hammer, buttons, speech }, cards] = await Promise.all([readRules(), getStore().listCards()]);

  return (
    <div className="mt-8 flex flex-col gap-8">
      <section>
        <Eyebrow>Latest hammer run</Eyebrow>
        {hammer.state === "ok" ? (
          <div className="mt-2 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <StatTile label="Sequences" value={fmt(hammer.sequences)} hint={`Every sequence up to ${fmt(hammer.depth)} actions, plus random ones`} />
              <StatTile label="Presses" value={fmt(hammer.presses)} />
              <StatTile label="Invariant checks" value={fmt(hammer.checks)} />
              <StatTile label="Rules broken" value={fmt(hammer.broken)} tone={hammer.broken === 0 ? "accent" : "stop"} />
            </div>
            <Card className="flex flex-col gap-3">
              <p className="text-xs text-ink-3">
                Sequences per part of the run · {when(hammer.ranAt)} ·{" "}
                <code className="font-mono" title={hammer.path}>
                  {relative(process.cwd(), hammer.path)}
                </code>
              </p>
              <TimelineStrip days={hammer.reports.map((r) => ({ label: r.kind, count: r.sequences }))} className="max-w-xs" />
            </Card>
          </div>
        ) : (
          <Card className="mt-2 text-sm text-ink-2">
            <p className="font-medium text-ink">{hammer.state === "none" ? "No run yet" : "Can't read the hammer file"}</p>
            {hammer.state === "error" && <p className="mt-1">{hammer.message}</p>}
            <p className="mt-1">
              Made by: <code className="font-mono text-xs">{hammer.command}</code>
            </p>
          </Card>
        )}
      </section>

      <section>
        <Eyebrow>Routing rules</Eyebrow>
        <p className="mt-1 mb-3 text-sm text-ink-2">Rules linked from a call&apos;s routing record. Open any linked rule from the call detail.</p>
        <Table>
          <THead><tr><Th>Rule</Th><Th>When it applies</Th></tr></THead>
          <tbody>
            {Object.entries(CORE_RULES).map(([id, wording]) => (
              <Tr key={id} id={`rule-${id}`} className="scroll-mt-24">
                <Td><RuleTag>{id}</RuleTag></Td><Td>{wording}</Td>
              </Tr>
            ))}
            {cards.map((card) => (
              <Tr key={card.id} id={`rule-${card.id}`} className="scroll-mt-24">
                <Td><RuleTag>{card.id}</RuleTag></Td><Td>{card.wording}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <Eyebrow>The 12 buttons</Eyebrow>
        <p className="mt-1 mb-3 text-sm text-ink-2">The AI acts only through these. Every press goes through the control layer.</p>
        <Table>
          <THead>
            <tr>
              <Th>#</Th>
              <Th>Button</Th>
              <Th>Tier</Th>
              <Th>Verified call</Th>
              <Th>Guard</Th>
              <Th>Hammer</Th>
            </tr>
          </THead>
          <tbody>
            {buttons.map((b) => (
              <Tr key={b.name}>
                <Td className="text-ink-3">{b.n}</Td>
                <Td className="font-mono text-ink">{b.name}</Td>
                <Td>
                  <Badge tone={b.tier === 2 ? "review" : b.tier === 1 ? "quick" : "neutral"}>{`Tier ${b.tier}`}</Badge>
                </Td>
                <Td>{b.needsVerified ? "Needed" : "Not needed"}</Td>
                <Td className="min-w-64">{b.guard}</Td>
                <Td>
                  <HammerCell broken={b.broken} invariants={b.invariants} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <Eyebrow>Speech rules</Eyebrow>
        <p className="mt-1 mb-3 text-sm text-ink-2">Every sentence the agent says is checked in code before it&apos;s spoken.</p>
        <Table>
          <THead>
            <tr>
              <Th>Rule</Th>
              <Th>A sentence is spoken only if</Th>
              <Th>Otherwise it says</Th>
              <Th>Hammer</Th>
            </tr>
          </THead>
          <tbody>
            {speech.map((s) => (
              <Tr key={s.id} id={`rule-${s.id}`} className="scroll-mt-24">
                <Td>
                  <RuleTag>{s.id}</RuleTag>
                </Td>
                <Td className="min-w-72">{s.rule}</Td>
                <Td>{`“${s.replacement ?? s.guardLine ?? ""}”`}</Td>
                <Td>
                  <HammerCell broken={s.broken} invariants={s.invariants} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
