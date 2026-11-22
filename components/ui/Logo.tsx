import { cn } from "./cn";

// The Aegis mark: our shield carrying a sheriff's star (rules in code are the law), with the
// two-tone capsule at its centre.
// It takes its colours from the tokens: green on warm white, bright green on the dark theme.
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="var(--rg-accent)" d="M16 1.75 28 6.25v8.6c0 7.3-4.9 13.3-12 15.4C8.9 28.15 4 22.15 4 14.85v-8.6L16 1.75Z" />
      <g fill="var(--rg-ink-inverse)">
        <path d="M16.00 7.00 L18.35 12.36 L24.18 12.94 L19.80 16.84 L21.05 22.56 L16.00 19.60 L10.95 22.56 L12.20 16.84 L7.82 12.94 L13.65 12.36Z" />
        <circle cx="16.0" cy="6.8" r="1.5" /><circle cx="24.37" cy="12.88" r="1.5" /><circle cx="21.17" cy="22.72" r="1.5" /><circle cx="10.83" cy="22.72" r="1.5" /><circle cx="7.63" cy="12.88" r="1.5" />
      </g>
      <g transform="rotate(45 16 15.9)" fill="var(--rg-accent)">
        <path d="M15.1 15.7v-1.5a.9.9 0 0 1 1.8 0v1.5h-1.8Z" />
        <path fillOpacity=".55" d="M15.1 16.1h1.8v1.5a.9.9 0 0 1-1.8 0v-1.5Z" />
      </g>
    </svg>
  );
}

/** "Aegis" in a Clarendon-style slab (Alfa Slab One, OFL), outlined so it loads no font. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 76.43 26.07" className={cn("shrink-0 fill-current", className)} role="img" aria-label="Aegis">
      <path d="M19.07 15.78H20.1V20H10.03V15.78H11.57L11.16 13.73H7.66L7.25 15.78H8.79V20H0V15.78H1.03L5.37 0H14.73ZM8.23 11H10.59L9.54 5.89H9.28ZM21.29 12.85Q21.29 9.18 23.34 7.26Q25.4 5.35 29.05 5.35Q32.67 5.35 34.28 7.24Q35.89 9.13 35.89 11.93V13.78H27.56V13.93Q27.56 14.88 28.12 15.33Q28.69 15.78 30 15.78Q31.57 15.78 32.98 15.55Q34.4 15.32 35.45 14.96V19.07Q34.55 19.56 32.81 19.96Q31.08 20.36 29.05 20.36Q25.4 20.36 23.34 18.44Q21.29 16.53 21.29 12.85ZM30.54 10.95V10.64Q30.54 9.77 30.17 9.38Q29.79 9 29.05 9Q28.3 9 27.93 9.4Q27.56 9.79 27.56 10.64V10.95ZM38.56 25.22V21Q41.29 21.49 43.44 21.49Q44.91 21.49 45.57 21.04Q46.22 20.59 46.22 19.36V18.25Q45.58 19.07 44.56 19.72Q43.55 20.36 42.24 20.36Q39.61 20.36 38.29 18.41Q36.97 16.45 36.97 12.85Q36.97 9.25 38.29 7.3Q39.61 5.35 42.24 5.35Q43.55 5.35 44.56 5.99Q45.58 6.63 46.22 7.46V5.71H53.26V9.92H52.13V18.97Q52.13 22.7 50.28 24.38Q48.43 26.07 44.7 26.07Q42.85 26.07 41.17 25.81Q39.49 25.55 38.56 25.22ZM46.22 14.14V11.57Q46.22 10.72 45.85 10.32Q45.48 9.92 44.73 9.92Q43.98 9.92 43.61 10.32Q43.24 10.72 43.24 11.57V14.14Q43.24 14.99 43.61 15.39Q43.98 15.78 44.73 15.78Q45.48 15.78 45.85 15.39Q46.22 14.99 46.22 14.14ZM55.73 4.29V0H60.98V4.29ZM54.5 20V15.78H55.63V9.92H54.5V5.71H61.54V15.78H62.67V20ZM63.91 19.33V15.53H68.07V15.78Q68.07 17.02 69.64 17.02Q71.03 17.02 71.03 16.07Q71.03 15.55 70.63 15.3Q70.23 15.04 69.23 14.86L67.94 14.63Q63.91 13.91 63.91 10.05Q63.91 7.81 65.6 6.58Q67.3 5.35 70.18 5.35Q73.39 5.35 75.6 6.43V10H71.7V9.74Q71.7 9.23 71.35 8.96Q71 8.69 70.33 8.69Q69.05 8.69 69.05 9.51Q69.05 9.95 69.41 10.18Q69.77 10.41 70.72 10.62L72.19 10.9Q74.47 11.34 75.45 12.52Q76.43 13.7 76.43 15.55Q76.43 17.89 74.79 19.13Q73.16 20.36 70.15 20.36Q66.92 20.36 63.91 19.33Z" />
    </svg>
  );
}

/** Mark plus wordmark. Use size to scale both together. */
export function Logo({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  // The wordmark box includes the g's descender, so it sits a little low to centre the capitals.
  const s = { sm: ["size-5", "h-[15px] translate-y-[1.5px]"], md: ["size-6", "h-[18px] translate-y-[2px]"], lg: ["size-9", "h-[27px] translate-y-[3px]"] }[size];
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <Mark className={s[0]} />
      <Wordmark className={s[1]} />
    </span>
  );
}
