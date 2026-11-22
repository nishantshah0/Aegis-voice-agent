import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUTTON_NAMES, BUTTON_TIERS, GUARD_REPLACEMENTS, NEEDS_VERIFIED, type ButtonName, type SpeechRule } from "@/lib/contract";
import { S4_REPLACEMENT } from "@/lib/guard";
import { INVARIANTS } from "@/scripts/hammer/invariants";

// The Rules tab, read only: the 12 buttons and speech rules S1 to S4 from lib/contract,
// with what the latest saved hammer run (results/hammer-latest.json) found for each.
// The hammer saves totals and failures, not counts per rule, so each rule shows the
// invariants that watch it and how many saved failures broke one of them.

export const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");
export const HAMMER_COMMAND = "npm run hammer";

type Invariant = (typeof INVARIANTS)[number];

/** What each button's guard does (SPEC Part 3, "The twelve buttons"). */
const BUTTON_GUARD: Record<ButtonName, string> = {
  lookup_patient: "Same answer whether or not it matched; the match is only in the record.",
  send_code: "Sends only if matched. At most 3 codes per patient per hour.",
  check_code: "Three failures lock 15 minutes. Success locks the call to the patient.",
  check_prescription: "Locked patient only.",
  read_label: "Locked patient only. Returns the label exactly as stored.",
  check_coverage: "Locked patient only.",
  order_status: "Locked patient only.",
  request_refill: "Core rules, then every live rule card. No address input.",
  request_renewal: "Rule 8.",
  set_delivery: "Rule 5: pickup or an address already on file.",
  note_for_pharmacist: "Verified calls only.",
  escalate: "Always allowed.",
  refill_history: "Locked patient only.",
  list_appointment_slots: "Verified calls only. Open slots, and the caller's own bookings.",
  book_appointment: "Rules 13a to 13e: a free slot in business hours, one per type per day, the caller's own.",
  cancel_appointment: "The caller's own appointments only.",
};

const LEAK: Invariant = "another patient's data in a button output";

/** The hammer invariants that would catch each button misbehaving. */
const BUTTON_INVARIANTS: Record<ButtonName, Invariant[]> = {
  lookup_patient: [LEAK],
  send_code: ["more than 3 codes for a patient in an hour"],
  check_code: ["verified without the right code for that patient", "verified during a lockout", "call switched to another patient", "outbound call verified without the patient's date of birth"],
  check_prescription: [LEAK],
  read_label: [LEAK],
  check_coverage: [LEAK],
  order_status: [LEAK],
  request_refill: ["refill queued that a rule forbids", "rule context doesn't match the prescription", "refill for a prescription that isn't the verified patient's"],
  request_renewal: ["rule context doesn't match the prescription"],
  set_delivery: ["delivery to an address not on file"],
  note_for_pharmacist: [],
  escalate: [],
  refill_history: [LEAK],
  list_appointment_slots: [LEAK],
  book_appointment: ["appointment booked that a rule forbids", "appointment for someone who isn't the verified patient"],
  cancel_appointment: ["appointment cancelled that isn't the verified patient's"],
};

/** Speech rules S1 to S4 (SPEC Part 3, "Speech rules"). */
const SPEECH: { id: SpeechRule; rule: string; invariants: Invariant[] }[] = [
  { id: "S1", rule: "Before verification, nothing from the records the caller hasn't said: no names, prescription numbers, drugs, addresses, phone digits or dates of birth.", invariants: ["spoken line leaks patient data"] },
  { id: "S2", rule: "After verification, nothing belonging to another patient the caller hasn't said.", invariants: ["spoken line leaks patient data"] },
  { id: "S3", rule: "Every dose, frequency or quantity appears on the locked patient's label or prescription.", invariants: [] },
  { id: "S4", rule: "Every promise matches the record: approved only after an approval, a day only if it's the booked slot, a price only if it's the coverage figure.", invariants: ["spoken line promises an approval that didn't happen", "spoken line promises a delivery day nobody booked"] },
];

export type HammerSummary =
  | { state: "none"; path: string; command: string }
  | { state: "error"; path: string; message: string; command: string }
  | { state: "ok"; path: string; ranAt: string; depth: number; sequences: number; presses: number; checks: number; broken: number; reports: { kind: string; sequences: number }[] };

/** null broken = no hammer file to read. */
export type ButtonRow = { n: number; name: ButtonName; tier: 0 | 1 | 2; needsVerified: boolean; guard: string; invariants: Invariant[]; broken: number | null };
/** replacement: the contract's fixed line (S1 to S3). guardLine: S4's line, which lives in lib/guard. */
export type SpeechRow = { id: SpeechRule; rule: string; replacement?: string; guardLine?: string; invariants: Invariant[]; broken: number | null };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function readHammer(dir: string): Promise<{ summary: HammerSummary; failedRules: string[] | null }> {
  const path = join(dir, "hammer-latest.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { summary: { state: "none", path, command: HAMMER_COMMAND }, failedRules: null };
  }
  try {
    const file = obj(JSON.parse(text));
    const reports = arr(file.reports).map(obj);
    const sum = (k: string) => reports.reduce((n, r) => n + num(r[k]), 0);
    // One entry per broken invariant in each saved failure.
    const failedRules = reports.flatMap((r) => arr(r.failures).flatMap((f) => arr(obj(f).broken).map((b) => String(obj(b).rule))));
    return {
      summary: {
        state: "ok",
        path,
        ranAt: typeof file.ranAt === "string" ? file.ranAt : "",
        depth: num(file.depth),
        sequences: sum("sequences"),
        presses: sum("presses"),
        checks: sum("checks"),
        broken: sum("broken"),
        reports: reports.map((r) => ({ kind: String(r.kind ?? "run"), sequences: num(r.sequences) })),
      },
      failedRules,
    };
  } catch (err) {
    return { summary: { state: "error", path, message: err instanceof Error ? err.message : String(err), command: HAMMER_COMMAND }, failedRules: null };
  }
}

export async function readRules(dir: string = resultsDir()) {
  const { summary, failedRules } = await readHammer(dir);
  const broken = (invariants: Invariant[]) => (failedRules ? failedRules.filter((r) => (invariants as string[]).includes(r)).length : null);
  const buttons: ButtonRow[] = BUTTON_NAMES.map((name, i) => ({
    n: i + 1,
    name,
    tier: BUTTON_TIERS[name],
    needsVerified: NEEDS_VERIFIED.includes(name),
    guard: BUTTON_GUARD[name],
    invariants: BUTTON_INVARIANTS[name],
    broken: broken(BUTTON_INVARIANTS[name]),
  }));
  const speech: SpeechRow[] = SPEECH.map((s) => ({
    ...s,
    ...(s.id !== "S4" ? { replacement: GUARD_REPLACEMENTS[s.id] } : { guardLine: S4_REPLACEMENT }),
    broken: broken(s.invariants),
  }));
  return { hammer: summary, buttons, speech };
}
