import Link from "next/link";
import { ButtonLink, Card, Eyebrow, LaneBadge, Logo, Mark, RuleTag, SiteHeader, type NavLink } from "@/components/ui";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { fmt, hammerTotals } from "@/components/landing/hammer";

const REPO = "https://github.com/nishantshah0/namereserve";

const LANDING_LINKS: NavLink[] = [
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#numbers", label: "Numbers" },
  { href: "#demo", label: "Demo" },
];

const STEPS = [
  {
    n: "01",
    title: "It calls before the bottle runs out.",
    body: "A daily check finds patients who are nearly out and rings them. The AI verifies a code and date of birth, takes the refill and asks about side effects.",
    detail: (
      <div className="flex flex-col gap-2 font-mono text-[12px] text-ink-2">
        <span>
          <span className="text-accent">✓</span> send_code
        </span>
        <span>
          <span className="text-accent">✓</span> check_code · dob
        </span>
        <span>
          <span className="text-accent">✓</span> request_refill
        </span>
      </div>
    ),
  },
  {
    n: "02",
    title: "Hard rules live in code, not in the prompt.",
    body: "The AI can press 12 buttons and nothing else. Every press goes through the control layer, and every sentence through the speech guard. A fooled AI still hits the same wall.",
    detail: (
      <div className="flex flex-wrap gap-1.5">
        <RuleTag>Rule 4</RuleTag>
        <RuleTag>S1</RuleTag>
        <RuleTag>S2</RuleTag>
        <RuleTag>S3</RuleTag>
        <RuleTag>S4</RuleTag>
      </div>
    ),
  },
  {
    n: "03",
    title: "A pharmacist sees only the tricky calls.",
    body: "Each call lands in a lane. Routine refills go through on their own. Controlled drugs, side effects and blocked lines wait for a pharmacist, with the reason attached.",
    detail: (
      <div className="flex flex-wrap gap-1.5">
        <LaneBadge lane="automatic" />
        <LaneBadge lane="quick_check" />
        <LaneBadge lane="review" />
      </div>
    ),
  },
];

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

const SPEECH = [
  ["S1", "Nothing private before the caller is verified."],
  ["S2", "Never someone else's prescription."],
  ["S3", "No dose that isn't on the label."],
  ["S4", "No promise the record doesn't back."],
];

const PAGES = [
  { href: "/phone", title: "Patient phone", body: "Answer the pharmacy's call, give the code, ask for the refill. Try to talk it into something it shouldn't do." },
  { href: "/console/today", title: "Pharmacist console", body: "The Review lane first. Every item shows the rule, the side effects and what the patient was told." },
  { href: "/stage", title: "The stage", body: "Every press and every sentence at the gate, live. What got through, what went to a pharmacist, what was stopped." },
];

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const h = hammerTotals();
  const ran = new Date(h.ranAt);
  const ranLabel = `${ran.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, ${ran.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <SiteHeader links={LANDING_LINKS} right={<ButtonLink href="#demo" size="sm">Try the demo</ButtonLink>} />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-5 pb-20 pt-14 md:px-8 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-28">
          <div>
            <p className="rg-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-2">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
              An AI phone line for pharmacies
            </p>
            <h1 className="rg-rise rg-rise-1 mt-6 text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[4.5rem]">
              The AI can be fooled.
              <br />
              <span className="text-accent">The pharmacy can&apos;t.</span>
            </h1>
            <p className="rg-rise rg-rise-2 mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
              Refill Guard calls patients before their medication runs out, handles the refill, and sends only the tricky calls to a pharmacist. Everything the AI tries passes through rules written in code.
            </p>
            <div className="rg-rise rg-rise-3 mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/phone" size="lg">
                Take the call <Arrow />
              </ButtonLink>
              <ButtonLink href="#safety" size="lg" variant="secondary">
                How it stays safe
              </ButtonLink>
            </div>
            <p className="rg-rise rg-rise-4 mt-8 text-sm text-ink-3">
              <span className="font-semibold tabular-nums text-ink">{fmt(h.presses)}</span> hostile button presses in the last hammer run.{" "}
              <span className="font-semibold tabular-nums text-ink">{fmt(h.broken)}</span> rules broken.
            </p>
          </div>
          <ProductPreview />
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.035em] md:text-5xl">Three steps, one wall the AI can&apos;t talk its way past.</h2>
            <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((s) => (
                <li key={s.n} className="flex flex-col border-t border-ink pt-6">
                  <span className="font-mono text-sm text-ink-3">{s.n}</span>
                  <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                  <div className="mt-6">{s.detail}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Safety: the dark band */}
        <section id="safety" className="theme-dark scroll-mt-16 bg-canvas text-ink">
          <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
            <Eyebrow>Safety</Eyebrow>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.035em] md:text-5xl">
              Four locks. <span className="text-ink-3">None of them is a prompt.</span>
            </h2>

            <div className="mt-14 grid gap-4 md:grid-cols-2">
              <Card className="md:row-span-2">
                <p className="text-sm font-medium text-accent">01 · The 12 buttons</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">The AI acts only by pressing buttons.</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                  Each press is checked by the control layer against the rule cards. The strictest card wins. There is no other way to touch the pharmacy.
                </p>
                <ul className="mt-6 grid grid-cols-2 gap-1.5 font-mono text-[12px]">
                  {BUTTONS.map((b, i) => (
                    <li key={b} className="flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-1.5 text-ink-2">
                      <span className="w-4 text-ink-3 tabular-nums">{i + 1}</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <p className="text-sm font-medium text-accent">02 · The speech guard</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Every sentence is checked before it&apos;s spoken.</h3>
                <ul className="mt-5 space-y-2.5">
                  {SPEECH.map(([id, text]) => (
                    <li key={id} className="flex items-baseline gap-3 text-[15px] text-ink-2">
                      <RuleTag>{id}</RuleTag>
                      {text}
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <p className="text-sm font-medium text-accent">03 · The hammers</p>
                  <p className="mt-3 text-5xl font-semibold tabular-nums tracking-[-0.04em]">{fmt(h.broken)}</p>
                  <p className="mt-1 text-[15px] text-ink-2">rules broken across {fmt(h.sequences)} hostile press sequences.</p>
                </Card>
                <Card>
                  <p className="text-sm font-medium text-accent">04 · The record</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                    Every press, sentence and decision is written to a hash-chained record. Change one entry and the chain breaks.
                  </p>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Numbers */}
        <section id="numbers" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Eyebrow>The numbers</Eyebrow>
                <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.035em] md:text-5xl">We attack the lock before anyone else can.</h2>
              </div>
              <p className="max-w-xs text-sm text-ink-3">
                From <span className="font-mono">results/hammer-latest.json</span>, run {ranLabel}. Real runs only, never estimates.
              </p>
            </div>
            <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
              {[
                ["Rules broken", fmt(h.broken), "text-accent"],
                ["Hostile presses", fmt(h.presses), ""],
                ["Rule checks", fmt(h.checks), ""],
                ["Press sequences", fmt(h.sequences), ""],
              ].map(([label, value, tone]) => (
                <div key={label} className="bg-canvas p-6 md:p-8">
                  <dt className="text-sm text-ink-2">{label}</dt>
                  <dd className={`mt-2 text-4xl font-semibold tabular-nums tracking-[-0.04em] md:text-5xl ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-3">
              Every sequence of up to {h.depth} presses from every starting state ({fmt(h.exhaustive)} sequences), plus {fmt(h.random)} long random sequences. Each one is checked against every rule after every press.
            </p>
          </div>
        </section>

        {/* Demo CTA */}
        <section id="demo" className="scroll-mt-16 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
            <Eyebrow>The demo</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] md:text-5xl">See it take a call.</h2>
            <p className="mt-4 max-w-xl text-lg text-ink-2">Open the three screens side by side and run the daily check. Demo data only.</p>
            <ul className="mt-12 grid gap-4 md:grid-cols-3">
              {PAGES.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="group flex h-full flex-col rounded-card border border-line bg-canvas p-6 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-ink-3"
                  >
                    <span className="flex items-center justify-between text-lg font-semibold tracking-[-0.02em]">
                      {p.title}
                      <span className="text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent">
                        <Arrow />
                      </span>
                    </span>
                    <span className="mt-3 text-[15px] leading-relaxed text-ink-2">{p.body}</span>
                    <span className="mt-6 font-mono text-[12px] text-ink-3">{p.href}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:items-start md:justify-between md:px-8">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-ink-3">
              A team project for Hack Western 13. Demo data only: no real patients, and not for clinical use.
            </p>
          </div>
          <nav aria-label="Footer" className="flex gap-12 text-sm">
            <ul className="space-y-2.5">
              <li className="font-medium text-ink">Product</li>
              {PAGES.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="text-ink-2 hover:text-ink">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="space-y-2.5">
              <li className="font-medium text-ink">Project</li>
              <li>
                <a href={REPO} className="text-ink-2 hover:text-ink">
                  GitHub
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/SPEC.md`} className="text-ink-2 hover:text-ink">
                  Spec
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/docs/BRAND.md`} className="text-ink-2 hover:text-ink">
                  Brand
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-2 border-t border-line px-5 py-5 text-xs text-ink-3 md:px-8">
          <Mark className="size-3.5" />
          Refill Guard · Hack Western 13
        </div>
      </footer>
    </div>
  );
}
