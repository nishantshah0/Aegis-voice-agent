import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "approve" | "deny";
type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-none font-mono font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out hover:-translate-x-px hover:-translate-y-px active:translate-x-0 active:translate-y-0 disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-[3px_3px_0_0_var(--rg-ink)] hover:shadow-[4px_4px_0_0_var(--rg-ink)] active:shadow-none",
  secondary: "border-2 border-ink bg-transparent text-ink hover:bg-ink hover:text-ink-inverse",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  approve: "bg-auto text-white shadow-[3px_3px_0_0_var(--rg-ink)] hover:shadow-[4px_4px_0_0_var(--rg-ink)] active:shadow-none",
  deny: "border-2 border-stop bg-transparent text-stop hover:bg-stop hover:text-white",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[11px]",
  md: "h-10 px-5 text-[12px]",
  lg: "h-12 px-6 text-[13px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

export function ButtonLink({ variant = "primary", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
