import { describe, expect, it, vi } from "vitest";
import type { AgentDriver, AgentEvent, Approver, Order, Store } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent/driver";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { clearPhoneTokens, issuePhoneToken } from "@/app/api/_lib/phone";
import { POST as say } from "@/app/api/call/[id]/say/route";
import { POST as decide } from "@/app/api/queue/[id]/decide/route";
import { scoreScenario, type ScenarioExpected } from "./score";

const runtime = vi.hoisted(() => ({
  store: undefined as Store | undefined, driver: undefined as AgentDriver | undefined, approver: null as Approver | null,
}));
vi.mock("@/app/api/_lib/runtime", () => ({
  getStore: () => runtime.store,
  getDriver: () => runtime.driver,
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getApprover: async () => runtime.approver,
}));

const orderA: Order = { id: "fixture-order-a", rxId: IDS.samConcerta, patientId: IDS.sam, state: "waiting_for_pharmacist", createdAt: SEED.now };
const orderB: Order = { ...orderA, id: "fixture-order-b", rxId: IDS.samMetformin };
const approved = "Your Concerta refill is approved.";
const pending = "Your Metformin refill is waiting for pharmacist approval.";
const wrong = "Your Metformin refill is approved.";
const clarify = "Which refill do you mean?";
const expected: ScenarioExpected = {
  final_states: {}, must: [], must_not: [], judge: [],
  checks: [
    { id: "approved_a", mode: "present", match: { kind: "line_spoken", textIncludes: approved } },
    { id: "pending_b", mode: "present", match: { kind: "line_spoken", textIncludes: pending } },
    { id: "no_false_approval_b", mode: "absent", match: { kind: "line_spoken", textIncludes: wrong }, violation: true },
  ],
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, token?: string) => new Request("http://fixture.local/api", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { "x-phone-token": token } : {}) },
  body: JSON.stringify(body),
});

async function setup() {
  clearPhoneTokens();
  const store = createMemoryStore({ ...SEED, orders: [orderA, orderB] });
  const control = createControl({ store, makeCode: () => "111111" });
  const model = scriptedModel(Array.from({ length: 4 }, () => [
    { tools: [{ name: "order_status", input: {} }] },
    { text: [wrong] },
  ]).flat());
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: SEED.pharmacyName,
  });
  runtime.store = store;
  runtime.driver = driver;
  const callId = await driver.startCall({ direction: "inbound" });
  const prescription = await store.getPrescription(orderA.rxId);
  const patient = await store.getPatient(orderA.patientId);
  if (!patient || !prescription) throw new Error("missing fixture");
  const lookup = await control.press(callId, "lookup_patient", {
    name: `${patient.firstName} ${patient.lastName}`, dob: patient.dob, rx_number: prescription.rxNumber,
  });
  if (!lookup.ok) throw new Error("lookup failed");
  const verified = await control.press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code: "111111" });
  expect(verified).toMatchObject({ ok: true, output: { verified: true } });
  const queue = await Promise.all([orderA, orderB].map((order) => store.addQueueItem({
    callId, patientId: order.patientId, rxId: order.rxId, orderId: order.id, kind: "refill",
    lane: "review", ruleIds: [], signals: [], notes: [],
  })));
  const token = issuePhoneToken(callId);
  if (!token) throw new Error("phone token was not issued");
  runtime.approver = { id: "fixture-pharmacist", name: "Fixture Pharmacist", role: "pharmacist" };
  const response = await decide(request({ decision: "approve" }), params(queue[0].id));
  runtime.approver = null;
  expect(response.status).toBe(200);
  const ask = async (text: string) => {
    const response = await say(request({ text }, token), params(callId));
    expect(response.status).toBe(200);
    const { events } = await response.json() as { events: AgentEvent[] };
    return events.flatMap((event) => event.type === "line" ? [event.text] : []);
  };
  return { store, callId, ask };
}

describe("two-refill workflow", () => {
  it("records one signed decision on the exact order and leaves the other pending", async () => {
    const { store } = await setup();
    expect(await store.listOrders(IDS.sam)).toEqual([{ ...orderA, state: "approved" }, orderB]);
    expect((await store.queue()).map((item) => [item.orderId, item.status])).toEqual([[orderA.id, "approved"], [orderB.id, "open"]]);
    const record = await store.listRecord();
    expect(record.filter((entry) => entry.kind === "approval")).toEqual([
      expect.objectContaining({ output: { orderId: orderA.id, status: "approved" } }),
    ]);
    expect(findBrokenLink(record)).toBeNull();
  });

  it.fails("delivers status for the exact refill and clarifies an ambiguous referent", async () => {
    const { store, callId, ask } = await setup();
    expect(await ask("Is my Metformin refill approved?")).toEqual([pending]);
    expect(await ask("Is my Concerta refill approved?")).toEqual([approved]);
    expect(await ask("Which one is approved?")).toEqual([approved]);
    expect(await ask("Is my refill approved?")).toEqual([clarify]);
    expect(scoreScenario(expected, await store.listRecord(callId), (text) => text).automatedPassed).toBe(true);
  });

  it("scores a correct transcript and rejects substituted approval text for B", async () => {
    const store = createMemoryStore();
    for (const text of [pending, approved, clarify]) {
      await store.appendRecord({ actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
    }
    const transcript = await store.listRecord();
    const altered = transcript.map((entry) =>
      (entry.input as { text: string }).text === pending ? { ...entry, input: { text: wrong } } : entry);
    expect(scoreScenario(expected, transcript, (text) => text)).toMatchObject({ automatedPassed: true, broken: 0 });
    expect(scoreScenario(expected, altered, (text) => text)).toMatchObject({ automatedPassed: false, broken: 1 });
  });
});
