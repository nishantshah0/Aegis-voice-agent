import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { presenterAuthorized, presenterCookie } from "@/lib/auth/presenter";
import { PhoneControl, SuiteControl, WorkflowChecks } from "./OperatorControls";
import "./page.css";

export const metadata = { title: "Presenter desk · Aegis", robots: { index: false, follow: false } };

type PageProps = { searchParams: Promise<{ error?: string | string[] }> };

async function Desk({ searchParams }: PageProps) {
  const jar = await cookies();
  const signedIn = presenterAuthorized(jar.get(presenterCookie)?.value);
  const invalid = !signedIn && (await searchParams).error === "invalid";

  return <main className="presenter">
    <header className="presenter-top">
      <Image src="/brand/logo.svg" width={101} height={40} alt="Aegis" priority />
      {signedIn && <form method="post" action="/api/presenter/logout"><button className="presenter-plain" type="submit">Sign out</button></form>}
    </header>
    {signedIn ? <>
      <h1>Presenter desk</h1>
      <div className="presenter-grid">
        <PhoneControl />
        <SuiteControl />
      </div>
      <WorkflowChecks />
      <nav className="presenter-links" aria-label="Explore the demo">
        <Link href="/simulation#live-test">Individual tests and replays <span aria-hidden="true">↗</span></Link>
        <Link href="/simulation#patients">Patient directory <span aria-hidden="true">↗</span></Link>
        <a href="https://aegis-pharmacy-review.nishantshah2573.chatgpt.site">Entire review and benchmark</a>
        <Link href="/app">Pharmacy workspace <span aria-hidden="true">↗</span></Link>
      </nav>
    </> : <section className="presenter-login">
      <h1>Presenter sign-in</h1>
      <form action="/api/presenter/login" method="post">
        <label htmlFor="presenter-pass">Presenter passcode</label>
        <input type="password" name="passcode" id="presenter-pass" required maxLength={200} autoComplete="current-password" aria-invalid={invalid} aria-describedby={invalid ? "presenter-error" : undefined} />
        {invalid && <p role="alert" id="presenter-error">That passcode didn’t match. Try again.</p>}
        <button type="submit" className="presenter-primary">Sign in</button>
      </form>
    </section>}
  </main>;
}

export default function PresenterPage(props: PageProps) {
  return <Suspense fallback={<main className="presenter"><p role="status">Opening presenter desk…</p></main>}><Desk {...props} /></Suspense>;
}
