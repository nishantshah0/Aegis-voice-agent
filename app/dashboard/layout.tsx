import { Suspense } from "react";
import { AppFrame } from "./_shell/AppFrame";
import { Account } from "./_shell/Account";
import { PhoneCard } from "./_shell/PhoneCard";
import { RequireSignIn } from "./_shell/RequireSignIn";

export const metadata = { title: "Aegis" };

function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-9 w-48 animate-pulse rounded-lg bg-sunken" />
      <div className="h-4 w-80 animate-pulse rounded bg-sunken" />
      <div className="mt-8 grid grid-cols-3 gap-3">
        <div className="h-24 animate-pulse rounded-card bg-sunken" />
        <div className="h-24 animate-pulse rounded-card bg-sunken" />
        <div className="h-24 animate-pulse rounded-card bg-sunken" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <AppFrame
      account={
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      }
      phone={
        <Suspense fallback={null}>
          <PhoneCard compact />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <RequireSignIn>{children}</RequireSignIn>
      </Suspense>
    </AppFrame>
  );
}
