import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type CardProps = HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article"; padded?: boolean };

/** The one surface: white (or raised dark) with a hairline border and a soft shadow. */
export function Card({ as: Tag = "div", padded = true, className, ...rest }: CardProps) {
  return <Tag className={cn("rounded-card border border-line bg-surface shadow-card", padded && "p-5", className)} {...rest} />;
}

/** Small uppercase label above a section or a figure. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs font-medium uppercase tracking-[0.08em] text-ink-3", className)} {...rest} />;
}
