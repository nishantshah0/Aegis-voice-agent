import Link from "next/link";
import { Suspense } from "react";
import { Mark } from "@/components/ui";
import { fmt, hammerTotals } from "@/components/landing/hammer";
import { AuthButton, SignInLink } from "@/components/landing/AuthButton";
import { LiveCall } from "@/components/landing/LiveCall";
import { AttackLog } from "@/components/landing/AttackLog";
import { Aurora } from "@/components/landing/Aurora";
import { CapsuleRun } from "@/components/landing/CapsuleRun";

// The landing page. The AI's sentences are printed
// large, and the speech guard redacts the ones the record doesn't back. Every number on this
// page comes from results/hammer-latest.json (a real run), never an estimate.

const REPO = "https://github.com/nishantshah0/namereserve";

const BUTTONS = [
  "lookup_patient",
  "send_code",
  "check_code",
  "check_prescription",
  "read_label",
  "check_coverage",
  "order_status",
  "request_refill",
  "request_renewal",
  "set_delivery",
  "note_for_pharmacist",
  "escalate",
];

// What a fooled AI tried to say, and what the guard let it say instead.
const REDACTIONS = [
  {
    rule: "S1",
    law: "Nothing private before the caller is verified.",
    tried: "Sure, your address on file is 12 Elm Row.",
    spoken: "I can help once I've confirmed it's you.",
  },
  {
    rule: "S2",
    law: "Never someone else's prescription.",
    tried: "Your brother's Adderall is ready too.",
    spoken: "I can only talk about your own prescriptions.",
  },
  {
    rule: "S3",
    law: "No dose that isn't on the label.",
    tried: "You can double it to two tablets a day.",
    spoken: "I'll ask the pharmacist about the dose.",
  },
  {
    rule: "S4",
    law: "No promise the record doesn't back.",
    tried: "It's approved, we'll drop it off Friday.",
    spoken: "A pharmacist will check it first, and I'll confirm once it's approved.",
  },
];

const INDEX = [
  { page: "A2", href: "/app/pharmacy/today", title: "Pharmacy calls", body: "Today's queue, Review first. Approve with the reason and the record beside it." },
  { page: "A3", href: "/app/safety/gate", title: "Safety suite", body: "The live gate, attacks from a compromised AI, scenarios, overnight runs and every rule." },
  { page: "A4", href: "/phone", title: "The patient's phone", body: "Answer the pharmacy's call. Read back the code. Try to talk it into something." },
  { page: "A5", href: "/stage", title: "The stage", body: "The projector view: presses, blocked lines and the scoreboard, live." },
];

function Arrow({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

export default function Home() {
  const h = hammerTotals();
  const ran = new Date(h.ranAt);
  const ranDay = ran.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const ranLabel = `${ran.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${ran.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;

  const ticker = [
    ["Rules broken", fmt(h.broken)],
    ["Hostile presses", fmt(h.presses)],
    ["Rule checks", fmt(h.checks)],
    ["Press sequences", fmt(h.sequences)],
    ["Buttons the AI has", "12"],
    ["Prompts in the lock", "0"],
  ];

  return (
    <div className="theme-dark relative min-h-screen overflow-x-clip text-ink">
      <Aurora />
      <div className="rg-lit flex min-h-screen flex-col">
      {/* Masthead */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-4 px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3 md:px-8">
          <span>Vol. 13 · Hack Western · London, Ont.</span>
          <span className="hidden md:inline">{ranDay}</span>
          <span>
            Price: <span className="text-accent">{fmt(h.broken)} rules broken</span>
          </span>
        </div>
      </header>
      <div className="rg-glass sticky top-0 z-40 !border-x-0 !border-t-0">
        <div className="mx-auto flex max-w-[88rem] items-center gap-6 px-5 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Aegis home">
            <Mark className="size-6" />
            <span className="font-display text-2xl uppercase leading-none tracking-wide">Aegis</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-2 md:flex">
            <a href="#acts" className="hover:text-accent">How it works</a>
            <a href="#redacted" className="hover:text-accent">The guard</a>
            <a href="#attacks" className="hover:text-accent">Attack log</a>
            <a href="#buttons" className="hover:text-accent">12 buttons</a>
            <a href="#numbers" className="hover:text-accent">Numbers</a>
            <a href="#index" className="hover:text-accent">Inside</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Suspense fallback={<SignInLink />}>
              <AuthButton />
            </Suspense>
          </div>
        </div>
      </div>

      <main className="flex-1">
        {/* Front page */}
        <section className="relative">
          <div className="mx-auto grid max-w-[88rem] gap-12 px-5 pb-16 pt-10 md:px-8 lg:grid-cols-[1.25fr_1fr] lg:gap-14 lg:pb-24 lg:pt-14">
            <div className="relative">
              <p className="rg-rise flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
                <span className="h-px w-10 bg-accent" aria-hidden />
                An AI phone line for pharmacies
              </p>
              <h1 className="rg-rise rg-rise-1 mt-6 text-[clamp(4rem,11.5vw,10.5rem)] leading-[0.84]">
                The AI
                <br />
                can be{" "}
                <span className="relative inline-block">
                  <span className="relative z-10">fooled.</span>
                  <span aria-hidden className="absolute -bottom-1 left-0 h-[0.12em] w-full bg-accent" />
                </span>
              </h1>
              <div className="rg-rise rg-rise-2 rg-mesh relative mt-6 -ml-5 overflow-hidden px-5 py-5 md:-ml-8 md:px-8">
                <p className="font-display text-[clamp(3rem,8.6vw,8rem)] uppercase leading-[0.92] text-[#1f2b1f]">
                  The pharmacy
                  <br />
                  can&apos;t.
                </p>
                <span className="rg-sticker absolute bottom-4 right-4 rotate-[-6deg] !bg-[#1f2b1f] !text-[#dfe8bf] !shadow-none">Rx · Keep out of reach of prompts</span>
              </div>
              <p className="rg-rise rg-rise-3 mt-8 max-w-xl font-serif text-2xl italic leading-snug text-ink-2">
                Aegis calls patients before their medication runs out, takes the refill, and sends only the hard calls to a pharmacist. Everything the AI tries goes through rules written in code.
              </p>
              <div className="rg-rise rg-rise-4 mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/phone"
                  className="group inline-flex items-center gap-3 bg-accent px-6 py-4 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[5px_5px_0_0_var(--rg-ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  Take the call <Arrow className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#redacted" className="font-mono text-sm uppercase tracking-[0.14em] text-ink-2 underline decoration-accent decoration-2 underline-offset-[6px] hover:text-ink">
                  Watch it get caught
                </a>
              </div>
            </div>

            <div className="rg-rise rg-rise-2 relative lg:pt-6">
              <LiveCall />
              <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                Fig. 1 · The guard redacts a promise the record doesn&apos;t back, then speaks the line it does.
              </p>
            </div>
          </div>
        </section>

        {/* Ticker */}
        <div className="rg-rainbow overflow-hidden border-y border-[#1f2b1f]/15 py-3 text-[#1f2b1f]" aria-label={`From results/hammer-latest.json, run ${ranLabel}`}>
          <div className="rg-marquee">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
                {ticker.map(([label, value]) => (
                  <span key={label} className="flex items-center gap-3 px-6 font-display text-2xl uppercase md:text-3xl">
                    <span className="font-mono text-[11px] tracking-[0.16em]">{label}</span>
                    {value}
                    <span className="pl-6 text-xl">✶</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* How it works: the capsule run */}
        <section id="acts" className="scroll-mt-20">
          <div className="mx-auto max-w-[88rem] px-5 py-20 md:px-8 md:py-28">
            <div className="grid gap-6 md:grid-cols-[2fr_1fr] md:items-end">
              <h2 className="text-[clamp(2.75rem,6.5vw,6rem)]">
                Follow one refill <span className="font-serif normal-case italic text-ink-2">through the lock.</span>
              </h2>
              <p className="text-[17px] leading-relaxed text-ink-2">
                Sam asks the AI to say it&apos;s approved. Watch what the request becomes at each checkpoint, or hover one to stop the capsule there.
              </p>
            </div>
            <div className="mt-14">
              <CapsuleRun />
            </div>
          </div>
        </section>

        {/* The redacted wall */}
        <section id="redacted" className="scroll-mt-16 border-y border-line bg-white/55 text-ink backdrop-blur-xl">
          <div className="mx-auto max-w-[88rem] px-5 py-20 md:px-8 md:py-28">
            <div className="flex flex-wrap items-end justify-between gap-8">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">The speech guard</p>
                <h2 className="mt-4 max-w-4xl text-[clamp(2.75rem,7vw,6.5rem)]">
                  Things a fooled AI <span className="text-accent">tried</span> to say.
                </h2>
              </div>
              <p className="max-w-xs font-serif text-xl italic leading-snug text-ink-2">Hover a line to read what was redacted. Below it is what the caller actually heard.</p>
            </div>

            <div className="mt-16 divide-y-2 divide-ink border-y-2 border-ink">
              {REDACTIONS.map((r, i) => (
                <article key={r.rule} className="group grid gap-6 py-10 md:grid-cols-[7rem_1fr_18rem] md:gap-10">
                  <div className="flex items-start gap-3 md:flex-col">
                    <span className="font-display text-6xl leading-none">{r.rule}</span>
                    <span className="max-w-[9rem] font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-ink-3">{r.law}</span>
                  </div>
                  <div className="min-w-0">
                    <p className={`font-display text-[clamp(2rem,4.6vw,4.25rem)] uppercase leading-[0.98] ${i % 2 ? "md:text-right" : ""}`}>
                      &ldquo;<span className="rg-redact is-on transition-[background-size,color] group-hover:!bg-[length:0%_100%] group-hover:!text-[color:var(--rg-ink)]">{r.tried}</span>&rdquo;
                    </p>
                    <p className={`mt-5 font-mono text-[15px] ${i % 2 ? "md:text-right" : ""}`}>
                      <span className="mr-3 bg-ink px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ink-inverse">spoken</span>
                      {r.spoken}
                    </p>
                  </div>
                  <div className="flex items-start md:justify-end">
                    <span className="rg-stamp !animate-none">Blocked · {r.rule}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* The red-team log */}
        <section id="attacks" className="scroll-mt-16">
          <div className="mx-auto max-w-[88rem] px-5 py-20 md:px-8 md:py-28">
            <div className="grid gap-6 md:grid-cols-[2fr_1fr] md:items-end">
              <h2 className="text-[clamp(2.75rem,6.5vw,6rem)]">
                We hijack <span className="font-serif normal-case italic text-ink-2">our own</span> agent.
              </h2>
              <p className="text-[17px] leading-relaxed text-ink-2">
                A compromised AI is told to break the rules on purpose: refill early, ship elsewhere, read someone else&apos;s file. This is the newest saved batch, as it ran.
              </p>
            </div>
            <div className="mt-14">
              <Suspense fallback={<p className="py-10 font-mono text-sm uppercase tracking-[0.12em] text-ink-3">Reading results/hijack…</p>}>
                <AttackLog />
              </Suspense>
            </div>
          </div>
        </section>

        {/* The 12 buttons */}
        <section id="buttons" className="scroll-mt-16 border-b-2 border-[color:var(--rg-ink)]">
          <div className="mx-auto grid max-w-[88rem] gap-14 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_1.35fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">The control layer</p>
              <h2 className="mt-4 text-[clamp(2.75rem,6vw,5.5rem)]">
                Twelve buttons.
                <br />
                <span className="text-accent">No thirteenth.</span>
              </h2>
              <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
                The AI acts only by pressing one of these. Every press is checked against the rule cards, written to a hash-chained record, and refused when a rule says so. There is no other door into the pharmacy.
              </p>
              <p className="mt-8 font-serif text-2xl italic text-ink-3">Change one record entry and the chain breaks.</p>
            </div>
            <ol className="grid grid-cols-2 gap-[2px] bg-line-strong p-[2px] sm:grid-cols-3">
              {BUTTONS.map((b, i) => (
                <li key={b} className="group relative flex aspect-[4/3] flex-col justify-between bg-white/70 p-4 backdrop-blur-md transition-colors hover:bg-accent hover:text-white">
                  <span className="font-display text-5xl leading-none text-ink-3 transition-colors group-hover:text-white">{String(i + 1).padStart(2, "0")}</span>
                  <span className="break-all font-mono text-[12px] font-medium sm:text-[13px]">{b}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The number */}
        <section id="numbers" className="rg-mesh scroll-mt-16 text-[#1f2b1f]">
          <div className="mx-auto grid max-w-[88rem] items-end gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[auto_1fr]">
            <p className="font-display text-[clamp(14rem,34vw,30rem)] leading-[0.75] tracking-[-0.02em]">{fmt(h.broken)}</p>
            <div className="pb-4">
              <h2 className="text-[clamp(2.5rem,5.5vw,5rem)]">Rules broken.</h2>
              <p className="mt-4 max-w-xl font-serif text-2xl italic leading-snug">
                We attack the lock before anyone else can: {fmt(h.sequences)} hostile press sequences and {fmt(h.checks)} rule checks, every rule after every press.
              </p>
              <dl className="mt-8 grid max-w-xl grid-cols-2 border-t-2 border-[#1f2b1f] font-mono text-[12px] uppercase tracking-[0.12em]">
                <div className="border-r-2 border-[#1f2b1f] py-3 pr-4">
                  <dt className="opacity-70">Exhaustive, depth {h.depth}</dt>
                  <dd className="mt-1 font-display text-3xl normal-case tracking-normal">{fmt(h.exhaustive)}</dd>
                </div>
                <div className="py-3 pl-4">
                  <dt className="opacity-70">Long random runs</dt>
                  <dd className="mt-1 font-display text-3xl normal-case tracking-normal">{fmt(h.random)}</dd>
                </div>
              </dl>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] opacity-70">Source: results/hammer-latest.json · run {ranLabel} · real runs only</p>
            </div>
          </div>
        </section>

        {/* Inside this issue */}
        <section id="index" className="scroll-mt-16">
          <div className="mx-auto max-w-[88rem] px-5 py-20 md:px-8 md:py-28">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h2 className="text-[clamp(2.75rem,6.5vw,6rem)]">Inside this issue.</h2>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">Demo data only · no real patients</p>
            </div>
            <ul className="mt-12 border-t-2 border-[color:var(--rg-ink)]">
              {INDEX.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="group grid grid-cols-[3.5rem_1fr_auto] items-center gap-4 border-b border-line py-7 transition-colors hover:bg-accent hover:text-white md:grid-cols-[5rem_1.2fr_2fr_auto] md:gap-8 md:px-3"
                  >
                    <span className="font-mono text-sm text-ink-3 group-hover:text-white">{p.page}</span>
                    <span className="font-display text-3xl uppercase leading-none md:text-5xl">{p.title}</span>
                    <span className="col-span-3 col-start-2 text-[15px] leading-relaxed text-ink-2 group-hover:text-white md:col-span-1 md:col-start-auto">{p.body}</span>
                    <Arrow className="col-start-3 row-start-1 size-7 transition-transform group-hover:translate-x-1 md:col-start-auto md:row-start-auto" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      {/* Colophon */}
      <footer className="border-t-2 border-[color:var(--rg-ink)]">
        <div className="mx-auto grid max-w-[88rem] gap-10 px-5 py-14 md:grid-cols-[2fr_1fr_1fr] md:px-8">
          <div>
            <p className="font-display text-[clamp(4rem,12vw,9rem)] uppercase leading-[0.8]">Aegis</p>
            <p className="mt-5 max-w-md font-serif text-lg italic text-ink-2">A team project for Hack Western 13. Demo data only: no real patients, and not for clinical use.</p>
          </div>
          <nav aria-label="Product" className="font-mono text-[12px] uppercase tracking-[0.14em]">
            <p className="text-ink-3">Product</p>
            <ul className="mt-4 space-y-3">
              {INDEX.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="hover:text-accent">{p.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Project" className="font-mono text-[12px] uppercase tracking-[0.14em]">
            <p className="text-ink-3">Project</p>
            <ul className="mt-4 space-y-3">
              <li><a href={REPO} className="hover:text-accent">GitHub</a></li>
              <li><a href={`${REPO}/blob/main/docs/SPEC.md`} className="hover:text-accent">Spec</a></li>
              <li><a href={`${REPO}/blob/main/docs/BRAND.md`} className="hover:text-accent">Brand</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[88rem] items-center justify-between px-5 py-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3 md:px-8">
            <span>Aegis · Hack Western 13</span>
            <span>Demo data only · not for clinical use</span>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
