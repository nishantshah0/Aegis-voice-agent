"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, cn, inputClass } from "@/components/ui";
import { EventFeed } from "@/app/console/today/EventFeed";
import { SlideOver } from "../pharmacy/_parts/SlideOver";
import { Icon } from "./Icon";

type Patient = { id: string; name: string };

const ROW = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50";

/**
 * Demo controls: Reset demo, Run daily check, pair the patient phone, open the phone, and
 * the live event feed. The same routes the old buttons on Today used.
 */
export function DemoMenuButton({ patients }: { patients: Patient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function run(path: string, describe: (body: Record<string, unknown>) => string) {
    setBusy(true);
    setStatus("Working…");
    const res = await fetch(path, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
    setBusy(false);
    setStatus(res?.ok ? describe(body ?? {}) : String(body?.error ?? `Failed (${res?.status ?? "network"})`));
    router.refresh();
  }

  async function pair() {
    setLink("");
    setCopied(false);
    setStatus("");
    const res = await fetch("/api/phone/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (!res?.ok || !body?.url) return setStatus(body?.error ?? `Failed (${res?.status ?? "network"})`);
    setLink(new URL(body.url, window.location.origin).toString());
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(buttonClass("secondary", "sm"), "h-8 gap-1.5 rounded-lg px-2.5 text-ink-2", open && "border-ink-3 text-ink")}
      >
        <Icon name="sliders" className="size-4" />
        Demo
      </button>

      {open && (
        <div role="menu" aria-label="Demo controls" className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-line-strong bg-raised p-1.5 shadow-pop">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Demo controls</p>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={ROW}
            onClick={() => run("/api/demo/reset", (b) => `Reset. Demo clock: ${new Date(String(b.now)).toLocaleString("en-US", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}`)}
          >
            <Icon name="home" className="size-4 text-ink-3" />
            Reset demo
          </button>
          {/* Trail #74: 40 scripted calls over the week before the demo clock, each through the real driver, buttons, guard and record. Idempotent; Reset demo clears it. */}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={ROW}
            onClick={() =>
              run("/api/demo/history", (b) => {
                const calls = Number(b.calls ?? 0);
                return b.seeded ? `Seeded ${calls} scripted calls from the past week.` : `The week is already seeded (${calls} calls).`;
              })
            }
          >
            <Icon name="calendar" className="size-4 text-ink-3" />
            Seed a week of calls
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={ROW}
            onClick={() =>
              run("/api/outbound/run-daily-check", (b) => {
                const rung = (b.callIds as string[] | undefined)?.length ?? 0;
                return rung === 0 ? "Daily check: nobody to ring right now." : `Daily check: ringing ${rung} patient${rung === 1 ? "" : "s"}.`;
              })
            }
          >
            <Icon name="calls" className="size-4 text-ink-3" />
            Run daily check
          </button>
          {/* Trail #70: a real call to the phone that stands in for Sam (TEST_PATIENT_PHONE, only in .env). */}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={ROW}
            onClick={() => run("/api/voice/outbound", (b) => `Calling Sam's real phone (call ${String(b.callId)}). It shows up in Calls like any other call.`)}
          >
            <Icon name="phone" className="size-4 text-ink-3" />
            Call Sam on a real phone
          </button>

          <div className="mx-1 my-1.5 rounded-lg border border-line bg-surface p-2.5" id="pair">
            <p className="text-[13px] font-medium text-ink">Pair the patient phone</p>
            <p className="mt-0.5 text-xs text-ink-3">Only the paired phone can answer that patient&apos;s calls.</p>
            <div className="mt-2 flex gap-1.5">
              <select aria-label="Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} className={inputClass("min-w-0 flex-1")}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={pair} className={buttonClass("secondary", "sm", "rounded-lg")}>
                Make link
              </button>
            </div>
            {link && (
              <div className="mt-2 rounded-md border border-line bg-sunken p-2">
                <p className="text-[11px] text-ink-3">Open on the patient&apos;s phone within 10 minutes. It works once.</p>
                <input
                  readOnly
                  value={link}
                  aria-label="Pairing link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1.5 w-full truncate rounded border border-line-strong bg-canvas px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(link)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false))
                    }
                    className={buttonClass("secondary", "sm", "h-7 flex-1 rounded-md text-xs")}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <a href={link} target="_blank" rel="noopener" className={buttonClass("secondary", "sm", "h-7 flex-1 rounded-md text-xs")}>
                    Open <Icon name="external" className="size-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>

          <a role="menuitem" href="/phone" target="_blank" rel="noopener" className={ROW}>
            <Icon name="phone" className="size-4 text-ink-3" />
            Open patient phone
            <Icon name="external" className="ml-auto size-3.5 text-ink-3" />
          </a>
          <button
            type="button"
            role="menuitem"
            className={ROW}
            onClick={() => {
              setFeed(true);
              setOpen(false);
            }}
          >
            <Icon name="feed" className="size-4 text-ink-3" />
            Live event feed
          </button>

          {status && (
            <p className="mx-1 mt-1 rounded-md bg-sunken px-2.5 py-2 text-xs text-ink-2" aria-live="polite">
              {status}
            </p>
          )}
        </div>
      )}

      <SlideOver open={feed} onClose={() => setFeed(false)} title="Live event feed">
        <EventFeed />
      </SlideOver>
    </div>
  );
}
