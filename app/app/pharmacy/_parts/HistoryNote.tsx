import { cn } from "@/components/ui";

// UI only (safe in client components). The ids come from scripted.ts on the server.

/**
 * Says plainly that a list includes the scripted demo week: real calls through the driver,
 * buttons, guard and record, but with a scripted model and made-up callers. Renders nothing
 * when there are none.
 */
export function HistoryNote({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn("inline-flex w-fit items-center gap-2 rounded-full border border-quick/25 bg-quick-soft/30 px-3 py-1 text-xs text-ink-2", className)}
      title="Seeded from the Demo menu: each call ran through the real driver, the 12 buttons, the speech guard and the hash-chained record, with a scripted model instead of a live one. Reset demo clears them."
    >
      <span aria-hidden className="size-1.5 rounded-full bg-quick" />
      Includes scripted demo history: {count} call{count === 1 ? "" : "s"} from the past week
    </span>
  );
}

/** A small tag for one scripted call in a list. */
export function ScriptedTag({ className }: { className?: string }) {
  return (
    <span title="Scripted demo history (seeded from the Demo menu)" className={cn("inline-flex items-center rounded-md border border-quick/30 px-1.5 text-[10px] font-medium uppercase tracking-wide text-quick", className)}>
      scripted
    </span>
  );
}
