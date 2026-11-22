import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { listLiveCalls } from "@/app/api/_lib/live-calls";
import { SignInCard, signedIn } from "../../SignedIn";
import { LiveCallView } from "./LiveCallView";

export const metadata = { title: "Live call · Safety suite · Aegis" };

// Calls saved when the app was built, plus "latest" (the newest call), so the route has
// params at build time; any other id renders on request.
export async function generateStaticParams() {
  const saved = await listLiveCalls(20);
  return [{ id: "latest" }, ...saved.map((c) => ({ id: c.id }))];
}

export default function LiveCallPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <Link href="/app/safety/live-calls" className="text-sm text-ink-2 hover:text-ink">
        ← Live calls
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Dialling…</p>}>
        <Call params={params} />
      </Suspense>
    </>
  );
}

async function Call({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!(await signedIn())) return <SignInCard />; // Checked here too, not only in the shell's layout.
  const { id } = await params;
  if (id === "latest") {
    const newest = (await listLiveCalls(1))[0];
    if (newest) redirect(`/app/safety/calls/${newest.id}`);
    return <p className="mt-6 text-sm text-ink-2">No live call yet. Start one from Live calls.</p>;
  }
  return (
    <div className="mt-4">
      <LiveCallView id={decodeURIComponent(id)} />
    </div>
  );
}
