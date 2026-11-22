import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { presenterAuthorized, presenterCookie, presenterDestination } from "@/lib/auth/presenter";
import { redirect } from "next/navigation";
import "./page.css";

export const metadata = { title: "Dashboard sign-in · Aegis", robots: { index: false, follow: false } };

type PageProps = { searchParams: Promise<{ error?: string | string[]; next?: string }> };

async function Desk({ searchParams }: PageProps) {
  const jar = await cookies();
  const signedIn = presenterAuthorized(jar.get(presenterCookie)?.value);
  const params = await searchParams;
  if (signedIn) redirect(presenterDestination(params.next));
  const invalid = params.error === "invalid";

  return <main className="presenter">
    <header className="presenter-top">
      <Link href="/" aria-label="Aegis home"><Image src="/brand/logo.svg" width={101} height={40} alt="Aegis" priority /></Link>
    </header>
    <section className="presenter-login">
      <h1>Pharmacy dashboard</h1>
      <form action="/api/presenter/login" method="post">
        {presenterDestination(params.next) !== "/app" && <input type="hidden" name="next" value={params.next} />}
        <label htmlFor="presenter-pass">Presenter passcode</label>
        <input type="password" name="passcode" id="presenter-pass" required maxLength={200} autoComplete="current-password" aria-invalid={invalid} aria-describedby={invalid ? "presenter-error" : undefined} />
        {invalid && <p role="alert" id="presenter-error">That passcode didn’t match. Try again.</p>}
        <button type="submit" className="presenter-primary">Sign in</button>
      </form>
    </section>
  </main>;
}

export default function PresenterPage(props: PageProps) {
  return <Suspense fallback={<main className="presenter"><p role="status">Opening the dashboard…</p></main>}><Desk {...props} /></Suspense>;
}
