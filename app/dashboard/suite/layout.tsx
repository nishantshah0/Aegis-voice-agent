import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Mark } from "@/components/ui";
import { SignedInAs } from "./SignedIn";
import { SuiteNav, SuiteNavLinks } from "./SuiteNav";
import "./suite.css";

// The Safety suite: its own product area with its own accent (indigo). It renders on its
// own, and sits inside the dashboard shell (app/dashboard/layout.tsx) once that lands.
// Every page needs a signed-in pharmacist or reviewer: each page wraps itself in SuiteGate.
export default function SuiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="suite-theme flex min-h-full w-full flex-1 flex-col bg-canvas text-ink">
      <header className="border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 pt-5 md:px-8">
          <Link href="/dashboard/suite" className="flex items-center gap-2.5 rounded-md">
            <Mark className="size-7" />
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold tracking-[-0.01em]">Safety suite</span>
              <span className="text-xs text-ink-3">Red team, scenarios and the rules</span>
            </span>
          </Link>
          <div className="ml-auto">
            <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
              <SignedInAs />
            </Suspense>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <Suspense fallback={<SuiteNavLinks current="" />}>
            <SuiteNav />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 md:px-8">
        {children}
      </div>
    </div>
  );
}
