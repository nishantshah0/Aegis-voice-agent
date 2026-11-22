import { Suspense } from "react";
import { Skeleton, SkeletonTiles } from "@/components/ui";
import { AppFrame } from "./_shell/AppFrame";
import { Account } from "./_shell/Account";
import { DemoMenu } from "./_shell/DemoMenu";
import { RequireSignIn } from "./_shell/RequireSignIn";

export const metadata = { title: "Aegis" };

function Loading() {
  return (
    <div aria-busy aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-80" />
      <SkeletonTiles className="mt-8" />
      <Skeleton className="mt-6 h-64 w-full rounded-card" />
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <AppFrame
      account={
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <Account />
        </Suspense>
      }
      demo={
        <Suspense fallback={null}>
          <DemoMenu />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <RequireSignIn>{children}</RequireSignIn>
      </Suspense>
    </AppFrame>
  );
}
