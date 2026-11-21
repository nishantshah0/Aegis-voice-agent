import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, CallRecordResponse, DecideResponse } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { getControl, getStore, resetRuntimeForTests } from "./_lib/runtime";
import { GET as callRecord } from "./calls/[id]/record/route";
import { POST as decide } from "./queue/[id]/decide/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const REVIEWER: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
const get = () => new Request("http://test.local/api");
const post = (body: unknown) =>
  new Request("http://test.local/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  session.approver = null;
  resetBusForTests();
  await resetRuntimeForTests();
});

describe("GET /api/calls/:id/record", () => {
  it("refuses someone who isn't signed in", async () => {
    expect((await callRecord(get(), params("c_0001"))).status).toBe(401);
  });

  it("returns only that call's entries, in order, with the record's head hash", async () => {
    session.approver = REVIEWER;
    const control = getControl();
    const a = await control.startInboundCall();
    const b = await control.startInboundCall();
    await control.press(a, "order_status", {});
    await control.press(b, "order_status", {});
    const res = await callRecord(get(), params(a));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CallRecordResponse;
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.callId === a)).toBe(true);
    expect(body.entries.map((e) => e.seq)).toEqual([...body.entries.map((e) => e.seq)].sort((x, y) => x - y));
    const all = await getStore().listRecord();
    expect(body.headHash).toBe(all[all.length - 1].hash);
  });

  it("never exports the control layer's internal output, so no code hash leaves the server", async () => {
    session.approver = REVIEWER;
    const control = getControl();
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    expect(lookup.ok).toBe(true);
    const lookupId = lookup.ok ? lookup.output.lookup_id : "";
    await control.press(callId, "send_code", { lookup_id: lookupId });
    const stored = await getStore().listRecord(callId);
    expect(JSON.stringify(stored)).toContain("codeHash");
    const body = (await (await callRecord(get(), params(callId))).json()) as CallRecordResponse;
    const buttons = body.entries.filter((e) => e.kind === "button");
    expect(buttons.map((e) => e.button)).toEqual(expect.arrayContaining(["lookup_patient", "send_code"]));
    const hasInternal = (o: unknown) => typeof o === "object" && o !== null && "internal" in o;
    expect(body.entries.filter((e) => hasInternal(e.output))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("codeHash");
  });

  it("answers 404 for a call that doesn't exist", async () => {
    session.approver = REVIEWER;
    expect((await callRecord(get(), params("c_9999"))).status).toBe(404);
  });
});

describe("2.8: Quick check one-tap approvals", () => {
  it("approves six Quick check items, each signed in the record by the pharmacist from the session", async () => {
    session.approver = PHARMACIST;
    const store = getStore();
    const items = [];
    for (let i = 1; i <= 6; i++) {
      items.push(
        await store.addQueueItem({ callId: `c_qc_${i}`, patientId: "p_sam", kind: "refill", lane: "quick_check", ruleIds: ["4"], signals: [], notes: [] }),
      );
    }
    for (const item of items) {
      const res = await decide(post({ decision: "approve" }), params(item.id));
      expect(((await res.json()) as DecideResponse).item).toMatchObject({ status: "approved", decidedBy: PHARMACIST });
    }
    const approvals = (await store.listRecord()).filter((e) => e.kind === "approval");
    expect(approvals).toHaveLength(6);
    for (const entry of approvals) expect(entry).toMatchObject({ actor: "pharmacist", input: { decision: "approve", approver: PHARMACIST } });
    expect((await store.queue("quick_check")).every((q) => q.status === "approved")).toBe(true);
  });
});

describe("two approvals of the same item at once (Trail #12, low)", () => {
  it("answers one with 200 and the other with 409, never 500", async () => {
    session.approver = PHARMACIST;
    const item = await getStore().addQueueItem({ callId: "c_race", patientId: "p_sam", kind: "refill", lane: "quick_check", ruleIds: ["4"], signals: [], notes: [] });
    const [a, b] = await Promise.all([decide(post({ decision: "approve" }), params(item.id)), decide(post({ decision: "approve" }), params(item.id))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(((await loser.json()) as { error: string }).error).toMatch(/already/i);
  });
});
