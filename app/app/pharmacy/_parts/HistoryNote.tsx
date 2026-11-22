import { cn } from "@/components/ui";

// UI only (safe in client components). The ids come from scripted.ts on the server.

/** A small tag for one scripted call in a list. */
export function ScriptedTag({ className }: { className?: string }) {
  return (
    <span title="Scripted demo history (seeded from the Demo menu)" className={cn("inline-flex items-center rounded-md border border-quick/30 px-1.5 text-[10px] font-medium uppercase tracking-wide text-quick", className)}>
      scripted
    </span>
  );
}
