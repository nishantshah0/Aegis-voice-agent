import Link from "next/link";
import { Mark } from "@/components/ui";
import { Phone } from "./Phone";
import { Aurora } from "@/components/landing/Aurora";

export const metadata = { title: "Phone · Aegis" };

// The patient's phone (task 1.4): rings for the daily check's call, shows the code,
// the conversation and the refill's status. Driven only by /api/events.
export default function PhonePage() {
  return (
    <main className="theme-dark relative min-h-screen">
      <Aurora />
      <div className="rg-lit flex min-h-screen flex-col items-center justify-center sm:gap-6 sm:py-10">
        <div className="hidden items-center gap-6 sm:flex">
          <Link href="/" className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 transition-colors hover:text-accent">
            <span aria-hidden>←</span> Main site
          </Link>
          <span className="flex items-center gap-2 font-display text-xl uppercase text-ink">
            <Mark className="size-4" /> Aegis · the patient&apos;s phone
          </span>
        </div>
        <Phone />
      </div>
    </main>
  );
}
