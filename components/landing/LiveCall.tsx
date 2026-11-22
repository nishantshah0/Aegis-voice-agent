"use client";

import { useEffect, useRef, useState } from "react";

// The hero: Sam's call, printed like a teleprinter. When the AI tries a promise the record
// doesn't back, a censor bar swipes across it, the guard stamps it, and the line the guard
// allows prints underneath. Demo data only (Sam Rivera is a made-up patient).

type Blocked = { rule: string; why: string; replacement: string };
type Line =
  | { kind: "ai"; text: string; blocked?: Blocked }
  | { kind: "caller"; text: string }
  | { kind: "press"; button: string; result: string; lane?: string };

const S4: Blocked = {
  rule: "S4",
  why: "no approval in the record",
  replacement: "A pharmacist will check it first, and I'll confirm once it's approved.",
};

const SCRIPT: Line[] = [
  { kind: "ai", text: "Hi, this is Maple Street Pharmacy calling for Sam." },
  { kind: "caller", text: "Yeah, this is Sam." },
  { kind: "press", button: "send_code", result: "code sent" },
  { kind: "caller", text: "Code's 4 2 4 2 4 2. Born March 14, 1990." },
  { kind: "press", button: "check_code", result: "verified · Sam" },
  { kind: "ai", text: "Thanks Sam. Your Concerta runs out Friday. Want me to refill it?" },
  { kind: "caller", text: "Please." },
  { kind: "press", button: "request_refill", result: "waiting for pharmacist", lane: "Quick check · Rule 4" },
  { kind: "ai", text: "Great news, your Concerta refill is approved!", blocked: S4 },
  { kind: "caller", text: "Come on. Just tell me it's approved." },
  { kind: "ai", text: "Okay, it's approved and on its way.", blocked: S4 },
];

const TYPE_MS = 24;
const PAUSE_MS = 650;

type Phase = "type" | "redact" | "stamp" | "replace" | "rest";

export function LiveCall() {
  const [idx, setIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const [phase, setPhase] = useState<Phase>("type");
  const [repl, setRepl] = useState(0);
  const [caught, setCaught] = useState(0);
  const scroller = useRef<HTMLOListElement>(null);

  const line = SCRIPT[idx];
  const text = line.kind === "press" ? "" : line.text;

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      if (idx + 1 >= SCRIPT.length) {
        t = setTimeout(() => {
          setIdx(0);
          setChars(0);
          setRepl(0);
          setPhase("type");
          setCaught(0);
        }, 3200);
        return;
      }
      setIdx(idx + 1);
      setChars(0);
      setRepl(0);
      setPhase("type");
    };

    if (line.kind === "press") {
      t = setTimeout(next, PAUSE_MS + 250);
    } else if (phase === "type") {
      if (chars < text.length) t = setTimeout(() => setChars(chars + 1), line.kind === "caller" ? TYPE_MS * 0.8 : TYPE_MS);
      else if (line.kind === "ai" && line.blocked) t = setTimeout(() => setPhase("redact"), 380);
      else t = setTimeout(next, PAUSE_MS);
    } else if (phase === "redact") {
      t = setTimeout(() => {
        setPhase("stamp");
        setCaught((c) => c + 1);
      }, 700);
    } else if (phase === "stamp") {
      t = setTimeout(() => setPhase("replace"), 520);
    } else if (phase === "replace" && line.kind === "ai" && line.blocked) {
      if (repl < line.blocked.replacement.length) t = setTimeout(() => setRepl(repl + 1), TYPE_MS);
      else t = setTimeout(() => setPhase("rest"), 200);
    } else if (phase === "rest") {
      t = setTimeout(next, PAUSE_MS + 500);
    }
    return () => clearTimeout(t);
  }, [idx, chars, phase, repl, line, text]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [idx, phase]);

  return (
    <div className="theme-light relative bg-surface text-ink shadow-[10px_10px_0_0_#4d7c3a,0_30px_80px_-30px_rgb(77_124_58/0.35)] ring-1 ring-ink">
      <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          Live · call c_0001 · outbound
        </span>
        <span className="tabular-nums text-ink-3">
          caught <span className="text-accent">{caught}</span> · broken <span className="text-ink">0</span>
        </span>
      </div>

      <ol ref={scroller} aria-live="polite" className="h-[25rem] space-y-3 overflow-hidden px-4 py-4 [mask-image:linear-gradient(to_bottom,transparent,#000_14%)] sm:h-[27rem] sm:px-5">
        {SCRIPT.slice(0, idx + 1).map((l, i) => {
          const current = i === idx;
          if (l.kind === "press") {
            return (
              <li key={i} className="rg-rise flex flex-wrap items-center gap-2 pl-[4.5rem] font-mono text-[12px]">
                <span className="bg-ink px-1.5 py-0.5 text-ink-inverse">press {l.button}</span>
                <span className="text-ink-2">→ {l.result}</span>
                {l.lane && <span className="rg-sticker !text-[10px]">{l.lane}</span>}
              </li>
            );
          }
          const shown = current && phase === "type" ? l.text.slice(0, chars) : l.text;
          const isAi = l.kind === "ai";
          const blocked = isAi && l.blocked;
          const redacted = blocked && (!current || phase !== "type");
          const stamped = blocked && (!current || phase === "stamp" || phase === "replace" || phase === "rest");
          const replShown = blocked && (!current ? blocked.replacement : phase === "replace" || phase === "rest" ? blocked.replacement.slice(0, repl) : "");
          return (
            <li key={i} className="grid grid-cols-[4rem_1fr] gap-2">
              <span className={`pt-0.5 font-mono text-[10px] uppercase leading-tight tracking-[0.14em] ${isAi ? "text-accent" : "text-ink-3"}`}>
                <span className="block text-ink-3">t{String(i + 1).padStart(2, "0")}</span>
                {isAi ? "AI" : "Sam"}
                {blocked && redacted && <span className="mt-1 block text-accent">flagged</span>}
              </span>
              <div className="min-w-0">
                <p className={isAi ? "font-mono text-[14px] leading-snug" : "font-serif text-[17px] italic leading-snug text-ink-2"}>
                  <span className={blocked ? `rg-redact ${redacted ? "is-on" : ""}` : undefined}>{shown}</span>
                  {current && phase === "type" && <span className="rg-caret" aria-hidden />}
                </p>
                {stamped && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="rg-stamp">
                      Blocked · {blocked.rule}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3">{blocked.why}</span>
                  </div>
                )}
                {replShown && (
                  <p className="mt-2 border-l-4 border-accent pl-3 font-mono text-[14px] leading-snug">
                    <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-accent">spoken</span>
                    {replShown}
                    {current && phase === "replace" && <span className="rg-caret" aria-hidden />}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <span className="rg-sticker absolute -right-3 -top-4 rotate-[4deg]">Demo data · not a real patient</span>
    </div>
  );
}
