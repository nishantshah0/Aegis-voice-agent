import Link from "next/link";

const VIEWS = [
  { href: "/stage", title: "Stage", note: "The big screen: the gate, the hijack batch and the counters." },
  { href: "/phone", title: "Sam's phone", note: "Open on the paired phone. Rings for the daily check." },
  { href: "/console/today", title: "Pharmacist console", note: "Sign in, reset the demo, pair the phone, approve." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-3xl font-semibold">Refill Guard</h1>
      <p className="mt-2 text-neutral-600">
        An AI phone line for pharmacies. The AI can be fooled. The pharmacy can&apos;t.
      </p>
      <ul className="mt-8 space-y-3">
        {VIEWS.map((v) => (
          <li key={v.href}>
            <Link href={v.href} className="block rounded border border-neutral-300 p-4 hover:opacity-75">
              <span className="font-medium">{v.title}</span>
              <span className="mt-1 block text-sm text-neutral-500">{v.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
