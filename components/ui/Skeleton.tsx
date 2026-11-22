import { cn } from "./cn";

/** A loading placeholder in the shape of what's coming. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rg-skeleton rounded-md", className)} />;
}

/** Placeholder rows for a table or list. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy aria-label="Loading" className={cn("overflow-hidden rounded-card border border-line bg-surface", className)}>
      <div className="h-9 border-b border-line bg-sunken/40" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a row of stat tiles. */
export function SkeletonTiles({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-14" />
        </div>
      ))}
    </div>
  );
}
