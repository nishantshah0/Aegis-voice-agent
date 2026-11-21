import { Suspense } from "react";
import { EventFeed } from "./EventFeed";
import { Queue } from "./Queue";
import { SignInBar } from "./SignInBar";

export const metadata = { title: "Today · Refill Guard" };

export default function TodayPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Today</h1>
        <Suspense fallback={<span className="text-sm text-neutral-500">Checking sign-in…</span>}>
          <SignInBar />
        </Suspense>
      </header>
      <Suspense fallback={<p className="mt-6 text-sm text-neutral-500">Loading the queue…</p>}>
        <Queue />
      </Suspense>
      <EventFeed />
    </main>
  );
}
