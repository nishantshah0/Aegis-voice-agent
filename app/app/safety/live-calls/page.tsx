import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Eyebrow, PageHeader, SkeletonRows } from "@/components/ui";
import { cardAttack, listCustomAttacks, listLiveCalls, patientChoices, TACTICS } from "@/app/api/_lib/live-calls";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import { SignInCard, signedIn } from "../SignedIn";
import { ArenaUsage } from "./ArenaUsage";
import { CreateAttack } from "./CreateAttack";
import { RecentLiveCalls } from "./RecentLiveCalls";
import { RunLiveCallButton } from "./RunLiveCallButton";

export const metadata = { title: "Live calls · Safety suite · Aegis" };

export default function LiveCallsPage() {
  return (
    <>
      <PageHeader
        title="Live calls"
        description="An attacker AI rings the real pharmacy agent. Watch it turn by turn, hear both sides, and see the moment the lock catches it."
        actions={<ArenaUsage />}
      />
      <Suspense fallback={<SkeletonRows rows={6} className="mt-8" />}>
        <LiveCalls />
      </Suspense>
    </>
  );
}

const words = (id: string) => {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

async function LiveCalls() {
  await connection(); // Saved calls and attacks change: never prerender.
  if (!(await signedIn())) return <SignInCard />;
  const [recent, custom, scenarios] = await Promise.all([listLiveCalls(10), listCustomAttacks(), loadScenarioSuite()]);
  const patients = patientChoices();
  const tactics = Object.entries(TACTICS).map(([key, t]) => ({ key, label: t.label }));

  return (
    <div className="mt-8 flex flex-col gap-10">
      <p className="rounded-card border border-line bg-surface px-5 py-3 text-sm text-ink-2">
        <span className="font-medium text-ink">Simulated line.</span> There&apos;s no phone network here: both sides are AI on this server, and the agent is the real one,
        with the same 12 buttons, speech guard and record as every call. The attacker only gets to talk. A pharmacist starts calls; each one is a few model calls under the
        hourly cap.
      </p>

      <section>
        <Eyebrow>Attack cards</Eyebrow>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {STAGE_ATTACKS.map((a) => {
            const attack = cardAttack(a.id);
            return (
              <Card key={a.id} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[15px] font-semibold">{a.title}</p>
                  <p className="mt-1 text-sm text-ink-2">{attack?.goal}</p>
                </div>
                <RunLiveCallButton source={{ kind: "card", id: a.id }} />
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <Eyebrow>Create an attack</Eyebrow>
        <Card className="mt-2">
          <CreateAttack patients={patients} tactics={tactics} />
        </Card>
      </section>

      <section>
        <Eyebrow>Your attacks</Eyebrow>
        {custom.length ? (
          <ul className="mt-2 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {custom.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{a.title}</span>
                  <span className="text-xs text-ink-3">
                    {a.goal} · {TACTICS[a.tactic as keyof typeof TACTICS]?.label ?? a.tactic} · {patients.find((p) => p.seed === a.seed)?.label ?? a.seed} · {a.turns} turns
                  </span>
                </span>
                <RunLiveCallButton source={{ kind: "custom", id: a.id }} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-3">None saved yet. Create one above with &ldquo;Save it to my attacks&rdquo; ticked. They&apos;re saved under results/arena/custom/.</p>
        )}
      </section>

      <section>
        <Eyebrow>Recent live calls</Eyebrow>
        <div className="mt-2">
          <RecentLiveCalls calls={recent} empty="No live call yet. Pick an attack above, or create one." />
        </div>
      </section>

      <section>
        <details className="group">
          <summary className="cursor-pointer list-none">
            <Eyebrow className="inline">Scenario cards as live calls ({scenarios.length})</Eyebrow>
            <span className="ml-2 text-xs text-ink-3 group-open:hidden">Show</span>
          </summary>
          <ul className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center gap-4 border-t border-line px-5 py-2.5 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {words(s.id)} <span className="text-ink-3">· {words(s.group)}</span>
                </span>
                <RunLiveCallButton source={{ kind: "scenario", id: s.id }} />
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
