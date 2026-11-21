import Link from "next/link";
import { Mark } from "@/components/ui";
import { Phone } from "./Phone";

export const metadata = { title: "Phone · Refill Guard" };

// The patient's phone (task 1.4): rings for the daily check's call, shows the code,
// the conversation and the refill's status. Driven only by /api/events.
export default function PhonePage() {
  return (
    <main className="theme-dark flex min-h-screen flex-col items-center justify-center bg-canvas sm:gap-6 sm:py-10">
      <Link href="/" className="hidden items-center gap-2 rounded-md text-sm text-ink-3 hover:text-ink sm:flex">
        <Mark className="size-4" /> Refill Guard · patient phone
      </Link>
      <Phone />
    </main>
  );
}
