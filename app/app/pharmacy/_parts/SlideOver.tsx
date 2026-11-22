"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui";

/** A panel from the right. Escape or the backdrop closes it; focus moves into it on open. */
export function SlideOver({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-ink/20 backdrop-blur-[1px]" />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn("relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-card outline-none", className)}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="text-lg font-semibold tracking-[-0.02em]">{title}</div>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-sm text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close panel">
            Esc
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
