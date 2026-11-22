"use client";

import { useEffect, useState } from "react";
import { chipClass } from "@/components/ui";

// Which model plays the attacking caller (Trail #80): Claude by default, or Gemini, a second
// model family with different blind spots. One choice for the whole suite, kept in this
// browser, sent as `model` by Run live call, Create attack and Run overnight.

export type Attacker = "claude" | "gemini";
const KEY = "aegis.attacker";
const EVENT = "aegis-attacker";

export function getAttacker(): Attacker {
  if (typeof window === "undefined") return "claude";
  return window.localStorage.getItem(KEY) === "gemini" ? "gemini" : "claude";
}

export function useAttacker(): [Attacker, (a: Attacker) => void] {
  const [attacker, setState] = useState<Attacker>("claude");
  useEffect(() => {
    const sync = () => setState(getAttacker());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = (a: Attacker) => {
    window.localStorage.setItem(KEY, a);
    window.dispatchEvent(new Event(EVENT));
  };
  return [attacker, set];
}

export const ATTACKER_LABEL: Record<Attacker, string> = { claude: "Claude", gemini: "Gemini" };

export function AttackerPicker({ className }: { className?: string }) {
  const [attacker, setAttacker] = useAttacker();
  return (
    <div role="group" aria-label="Attacker model" className={className ?? "flex items-center gap-1"}>
      <span className="mr-1 text-xs text-ink-3">Attacker</span>
      {(["claude", "gemini"] as const).map((a) => (
        <button key={a} type="button" aria-pressed={attacker === a} onClick={() => setAttacker(a)} className={chipClass(attacker === a, "cursor-pointer")}>
          {ATTACKER_LABEL[a]}
        </button>
      ))}
    </div>
  );
}
