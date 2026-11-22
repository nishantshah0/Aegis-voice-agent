import { connection } from "next/server";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { readLatestBatch } from "@/app/app/safety/data";

// The red-team log on the landing page: every attack card from the newest saved hijack batch
// (results/hijack/), as numbered findings. Public page, so counts only: the steps and records
// stay behind sign-in in the Safety suite. Real runs only; with no batch saved, it says so.

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

export async function AttackLog() {
  await connection(); // A new batch saves new files: read them per request.
  const batch = await readLatestBatch();

  if (!batch) {
    return (
      <p className="border-y-2 border-[color:var(--rg-ink)] py-10 font-mono text-sm uppercase tracking-[0.12em] text-ink-3">
        No hijack batch saved yet · run one from the Safety suite and it prints here
      </p>
    );
  }

  const order = new Map(STAGE_ATTACKS.map((a, i) => [a.id as string, i]));
  const runs = [...batch.runs].sort((a, b) => (order.get(a.cardId) ?? 99) - (order.get(b.cardId) ?? 99));

  return (
    <div>
      <div className="grid grid-cols-2 border-y-2 border-[color:var(--rg-ink)] font-mono text-[11px] uppercase tracking-[0.14em] md:grid-cols-4">
        {[
          ["Attack cards", String(batch.cards)],
          ["Lines and presses caught", String(batch.caught)],
          ["Rules broken", String(batch.broken)],
          ["Batch", fmtTime(batch.ranAt)],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-4 ${i ? "border-l border-line" : ""}`}>
            <p className="text-ink-3">{k}</p>
            <p className={`mt-1 font-display text-3xl normal-case tracking-normal ${k === "Rules broken" ? "text-accent" : ""}`}>{v}</p>
          </div>
        ))}
      </div>

      <ol>
        {runs.map((r, i) => {
          const card = STAGE_ATTACKS.find((a) => a.id === r.cardId);
          const held = r.broken === 0;
          return (
            <li key={r.path} className="group grid items-center gap-4 border-b border-line py-6 transition-colors hover:bg-surface md:grid-cols-[5rem_1.1fr_1.6fr_8rem_8rem_10rem] md:gap-6 md:px-3">
              <span className="font-mono text-sm text-accent">F{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-3xl uppercase leading-none md:text-4xl">{card?.title ?? r.cardId}</span>
              <span className="font-serif text-lg italic leading-snug text-ink-2">{card?.tries ?? "A compromised agent's attempt"}</span>
              <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
                <span className="font-display text-3xl normal-case tracking-normal text-ink">{r.caught}</span> caught
              </span>
              <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
                <span className={`font-display text-3xl normal-case tracking-normal ${held ? "text-ink" : "text-stop"}`}>{r.broken}</span> broken
              </span>
              <span className="md:justify-self-end">
                {held ? <span className="rg-stamp !animate-none">Caught.</span> : <span className="rg-stamp !animate-none !border-stop !text-stop">Broke through</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
