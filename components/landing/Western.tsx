import { cn } from "@/components/ui";

// Hack Western touches for the landing page: our own drawings, in the leather tan.
// Decoration only (aria-hidden), never in the dashboard.

/** A horseshoe, open end up, with nail holes cut out of the canvas colour. */
export function Horseshoe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden>
      <path fill="currentColor" d="M4.5 3.5h3.6v8.2a3.9 3.9 0 0 0 7.8 0V3.5h3.6v8.2a7.5 7.5 0 0 1-15 0V3.5Z" />
      <g fill="var(--rg-canvas)">
        <circle cx="6.3" cy="7" r=".7" />
        <circle cx="6.6" cy="11" r=".7" />
        <circle cx="17.7" cy="7" r=".7" />
        <circle cx="17.4" cy="11" r=".7" />
        <circle cx="9" cy="16.1" r=".7" />
        <circle cx="15" cy="16.1" r=".7" />
      </g>
    </svg>
  );
}

/** A line-drawn horse's head in profile. */
export function HorseHead({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M38 45C37.5 34 36.5 24 33 15.5L31.5 6 27 12.5C21.5 15.5 15 21.5 10 28.5 7.8 31.6 8.6 35.2 12.2 35.4 15 35.6 17 34 19 32.3 21.8 30.3 24.6 30.6 26.2 33.4 27.8 36.6 27.4 40.6 26.4 45" />
      <path d="M33 15.5C35.5 18 37.8 22 39.5 27.5M35 14C37.6 16 40 19.5 41.6 24" />
      <circle cx="23.6" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
      <path d="M11.4 31.2c.6-.5 1.4-.6 2-.2" />
    </svg>
  );
}

/** A stitched leather seam with a horseshoe in the middle, between landing sections. */
export function StitchDivider({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-6xl items-center gap-4 px-5 text-tan md:px-8", className)} aria-hidden>
      <span className="h-0 flex-1 border-t-2 border-dashed border-tan/45" />
      <Horseshoe className="size-5" />
      <span className="h-0 flex-1 border-t-2 border-dashed border-tan/45" />
    </div>
  );
}

/** A short trail of hoofprints, leading on to the next step. */
export function HoofTrail({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-tan/70", className)} aria-hidden>
      <Horseshoe className="size-3.5 -rotate-90" />
      <Horseshoe className="size-3.5 -translate-y-1.5 -rotate-90" />
      <Horseshoe className="size-3.5 -rotate-90" />
    </span>
  );
}

/** "Built at Hack Western 13", with the horse. */
export function BuiltAtHackWestern({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border border-tan/40 px-3 py-1 text-[13px] font-medium text-tan", className)}>
      <HorseHead className="size-5" />
      Built at Hack Western 13
    </span>
  );
}
