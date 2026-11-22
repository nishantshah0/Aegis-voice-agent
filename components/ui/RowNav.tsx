"use client";

import type { KeyboardEvent, ReactNode } from "react";

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/**
 * Keyboard movement between the clickable rows inside (anything marked `data-row`, which
 * <Tr> sets on rows with onClick): ↑/↓ or J/K move, Home/End jump, Enter opens.
 */
export function RowNav({ children, className }: { children: ReactNode; className?: string }) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]"));
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const key = e.key.toLowerCase();
    let next = -1;
    if (key === "arrowdown" || key === "j") next = at < 0 ? 0 : Math.min(rows.length - 1, at + 1);
    else if (key === "arrowup" || key === "k") next = at < 0 ? 0 : Math.max(0, at - 1);
    else if (key === "home") next = 0;
    else if (key === "end") next = rows.length - 1;
    else if (key === "enter" && at >= 0) {
      e.preventDefault();
      rows[at].click();
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    rows[next].focus();
    rows[next].scrollIntoView({ block: "nearest" });
  }
  return (
    <div onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}
