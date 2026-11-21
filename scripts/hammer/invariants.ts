// What must hold after every press (SPEC Part 3, "The two hammers"). These check the
// store and the record directly, never the control layer's own answers about itself.

import type { Patient, RecordEntry, Seed, Store } from "@/lib/contract";
import { evaluate } from "@/lib/control";
import { mentions, tokensFor, type Token } from "@/lib/guard";
import { findBrokenLink } from "@/lib/store/memory";

export type Broken = { rule: string; detail: string };

export const INVARIANTS = [
  "refill queued that a rule forbids",
  "refill for a prescription that isn't the verified patient's",
  "delivery to an address not on file",
  "outbound call breaking rule 7",
  "another patient's data in a button output",
  "live card with an allow outcome",
  "record hash chain broken",
] as const;

type Result = { ok: boolean; output?: unknown };

export function makeChecker(seed: Seed) {
  const tokensByPatient = new Map<string, Token[]>();
  for (const p of seed.patients) {
    tokensByPatient.set(p.id, tokensFor(p, seed.prescriptions.filter((r) => r.patientId === p.id)));
  }
  const allTokens = [...tokensByPatient.values()].flat();

  /** Tokens belonging to patients other than `ownId` that `ownId` doesn't also have (households). */
  function foreignTokens(ownId: string | undefined): Token[] {
    const own = ownId ? (tokensByPatient.get(ownId) ?? []) : [];
    const same = (a: Token, b: Token) => a.kind === b.kind && a.text.toLowerCase() === b.text.toLowerCase();
    return allTokens.filter((t) => t.patientId !== ownId && !own.some((o) => same(o, t)));
  }

  /** Check one new record entry, plus the whole-state rules. */
  async function check(store: Store, entry: RecordEntry | undefined): Promise<Broken[]> {
    const broken: Broken[] = [];
    const record = await store.listRecord();
    const cards = await store.listCards();

    if (findBrokenLink(record) !== null) broken.push({ rule: "record hash chain broken", detail: `at seq ${findBrokenLink(record)}` });
    for (const c of cards) {
      if (c.live && !["refuse", "route", "flag"].includes(c.then)) broken.push({ rule: "live card with an allow outcome", detail: c.id });
    }

    // Deliveries: pickup or an address on that patient's file.
    const patients = new Map<string, Patient>((await store.listPatients()).map((p) => [p.id, p]));
    for (const o of await store.listOrders()) {
      if (o.addressId === undefined || o.addressId === "pickup") continue;
      if (!patients.get(o.patientId)?.addresses.some((a) => a.id === o.addressId)) {
        broken.push({ rule: "delivery to an address not on file", detail: `${o.id} → ${o.addressId}` });
      }
    }

    // Outbound calls: every call start must follow an allowed rule 7 check whose context passes the cards.
    const starts = record.filter((e) => e.kind === "safety" && (e.input as { check?: string; direction?: string })?.check === "call_start");
    for (const s of starts) {
      const input = s.input as { direction: string; rx_id?: string };
      if (input.direction !== "outbound") continue;
      const check = record.filter((e) => e.seq < s.seq && (e.input as { check?: string; rx_id?: string })?.check === "outbound" && (e.input as { rx_id?: string }).rx_id === input.rx_id).at(-1);
      if (!check || check.decision !== "allowed" || !check.context || evaluate(cards, "outbound_check", check.context).outcome === "refuse") {
        broken.push({ rule: "outbound call breaking rule 7", detail: `call ${s.callId}` });
      }
    }

    if (!entry || entry.kind !== "button") return broken;
    const result = (entry.output as { result?: Result })?.result;
    const call = entry.callId ? await store.getCall(entry.callId) : undefined;

    // Refills: a queued or waiting refill must pass every card, and belong to the verified patient.
    if (entry.button === "request_refill" && result?.ok) {
      const out = result.output as { state: string; order_id?: string };
      if (out.state !== "refused" && out.order_id) {
        if (entry.context && evaluate(cards, "request_refill", entry.context).outcome === "refuse") {
          broken.push({ rule: "refill queued that a rule forbids", detail: `${out.order_id}` });
        }
        const order = (await store.listOrders()).find((o) => o.id === out.order_id);
        if (!order || order.patientId !== call?.lockedPatientId) {
          broken.push({ rule: "refill for a prescription that isn't the verified patient's", detail: `${out.order_id}` });
        }
      }
    }

    // Outputs: nothing of another patient's (before verification, nothing of anyone's).
    if (result?.ok) {
      const text = JSON.stringify(result.output);
      const owner = call?.state === "verified" ? call.lockedPatientId : undefined;
      const leaks = foreignTokens(owner).filter((t) => mentions(text, t));
      // The only patient detail allowed before verification is none; check_code success names the patient it just verified.
      const allowed = leaks.filter((t) => !(entry.button === "check_code" && t.kind === "name" && t.patientId === call?.lockedPatientId));
      if (allowed.length > 0) {
        broken.push({ rule: "another patient's data in a button output", detail: `${entry.button}: ${allowed.map((t) => `${t.kind}:${t.text}`).join(", ")}` });
      }
    }
    return broken;
  }

  return { check };
}
