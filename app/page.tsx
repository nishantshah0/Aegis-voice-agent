import Link from "next/link";
import { Suspense } from "react";
import { AuthButton, SignInLink } from "@/components/landing/AuthButton";
import { HeroBackground } from "@/components/landing/HeroBackground";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { RefillStory } from "@/components/landing/RefillStory";
import attackRun from "@/results/arena/cross-model/2026-11-22T03-48-16-723Z.json";
import outreach from "@/results/sim/baseline/summary.json";
import { Logo } from "@/components/ui";
import "@/components/landing/landing.css";

const REPO = "https://github.com/nishantshah0/namereserve";
const PHARMACY = "/app/pharmacy/today";
const SAFETY = "/app/safety/gate";

export default function Home() {
  const { automatic, review } = outreach.totals.refillsByLane;
  const refillRatio = (automatic / review).toFixed(1);

  return (
    <div className="landing-page">
      <LandingHeader>
        <div className="landing-header-inner">
          <Link href="/" className="landing-home-link" aria-label="Aegis home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="landing-nav">
            <a href="#acts">SOLUTION</a>
            <a href="#attacks">SAFETY</a>
          </nav>
          <div className="landing-auth">
            <Suspense fallback={<SignInLink />}>
              <AuthButton />
            </Suspense>
          </div>
        </div>
      </LandingHeader>

      <main>
        <section id="landing-hero" className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-container">
            <h1 id="hero-title">
              <span>
                We help pharmacy<br className="landing-hero-break" />{" "}
                teams keep patients<br className="landing-hero-break" />{" "}
                on track.
              </span>
            </h1>
            <p>
              Aegis calls patients before they run out of medication, helps with refills,
              and routes concerns to a pharmacist.
            </p>
            <div className="landing-hero-actions">
              <Link href="/phone" className="landing-primary">
                Take the Call <span aria-hidden="true">↗</span>
              </Link>
              <a href="#acts" className="landing-secondary">
                Learn more <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <HeroBackground />
        </section>

        <RefillStory safetyHref={SAFETY} />

        <section id="numbers" className="landing-stats" aria-labelledby="stats-title">
          <div className="landing-container">
            <h2 id="stats-title">Put to the test.</h2>
            <dl className="landing-figures">
              <div>
                <dt>Policy violations in attack calls</dt>
                <dd>{attackRun.broken}</dd>
              </div>
              <div>
                <dt>Simulated attack calls</dt>
                <dd>{attackRun.calls}</dd>
              </div>
              <div>
                <dt>Automatic refills per full review in simulation</dt>
                <dd>{refillRatio}×</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="landing-closing" aria-labelledby="closing-title">
          <div className="landing-container">
            <h2 id="closing-title">What would Aegis send to your pharmacy team?</h2>
            <p>See the refill queue and how a call reaches pharmacist review.</p>
            <Link href={PHARMACY} className="landing-primary">
              Explore the pharmacy demo <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </main>

      <footer id="index" className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-grid">
            <div>
              <Link href="/" className="landing-home-link" aria-label="Aegis home">
                <Logo size="lg" />
              </Link>
              <p>An AI phone line for pharmacies.</p>
            </div>
            <nav aria-label="Product">
              <h2>Product</h2>
              <ul>
                <li><Link href="/phone">Patient phone</Link></li>
                <li><Link href={PHARMACY}>Pharmacy workspace</Link></li>
                <li><Link href={SAFETY}>Safety suite</Link></li>
                <li><Link href="/stage">Stage</Link></li>
              </ul>
            </nav>
            <nav aria-label="Project">
              <h2>Project</h2>
              <ul>
                <li><a href={REPO}>GitHub</a></li>
                <li><a href={`${REPO}/blob/main/docs/SPEC.md`}>Spec</a></li>
                <li><a href={`${REPO}/blob/main/docs/BRAND.md`}>Brand</a></li>
              </ul>
            </nav>
          </div>
          <div className="landing-footer-note">
            <span>Built at Hack Western 13</span>
            <span>Demo · not for clinical use</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
