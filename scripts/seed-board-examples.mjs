// Run from the repository root with AEGIS_DEMO_STORAGE_URL for the isolated hosted demo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";
import pg from "pg";
import { createServer } from "vite";

const url = process.env.AEGIS_DEMO_STORAGE_URL;
assert(url && !process.env.DATABASE_URL, "Supply only the isolated demo storage URL.");
const vite = await createServer({ configFile: false, appType: "custom",
  resolve: { alias: { "@": resolve(".") } }, server: { middlewareMode: true, ws: false } });
const { createPostgresStore, poolConfig, fromPgPool } = await vite.ssrLoadModule("/lib/store/postgres.ts");
const { createControl } = await vite.ssrLoadModule("/lib/control/index.ts");
const pool = new pg.Pool({ ...poolConfig(url, readFileSync("certs/tiger-cloud-ca.pem", "utf8")), max: 1 });
const examples = [
  { patient: "p_jordan", kind: "side_effect", text: "I have had mild headaches since my last refill. Could a pharmacist call me back?" },
  { patient: "p_maria", kind: "question", text: "My refill label looks different. Could a pharmacist review it with me?", hours: 26 },
  { patient: "p_lena", kind: "question", text: "I missed a dose while travelling and would like to speak with a pharmacist.", hours: 54 },
];
const marker = "board_examples_v1";
try {
  const db = fromPgPool(pool);
  const result = await db.transaction(async query => {
    const { rows: [scope] } = await query("select current_schema() as schema, current_user as role");
    assert.equal(scope.schema, "aegis_demo");
    assert.notEqual(scope.role, "tsdbadmin");
    await query("select pg_advisory_xact_lock(739207115)");
    const { rows: [meta] } = await query("select now, policy from rg_meta where id=1 for update");
    assert(meta, "Expected the existing demo schema.");
    const seen = await query("select 1 from rg_record where doc->'input'->>'fixture'=$1 limit 1", [marker]);
    if (seen.rows.length) return "Existing examples retained.";
    const slots = [...(meta.policy.appointmentSlots ?? [])];
    for (const example of examples.filter(row => row.hours)) {
      const start = new Date(Date.parse(meta.now) + example.hours * 3600000);
      const label = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(start) + " Eastern";
      const id = marker + "_" + example.patient;
      assert(!slots.some(slot => slot.id === id), "Example slot is already in use.");
      slots.push({ id, start: start.toISOString(), label });
    }
    await query("update rg_meta set policy=jsonb_set(policy,'{appointmentSlots}',$1::jsonb) where id=1",[JSON.stringify(slots)]);
    const store = createPostgresStore({ query, transaction: fn => fn(query) });
    const code = String(randomInt(100000, 1000000));
    const control = createControl({ store, makeCode: () => code, broadcastCodes: false, callIdPrefix: "demo_board_" });
    const summary = [];
    for (const example of examples) {
      const patient = await store.getPatient(example.patient);
      const [rx] = await store.getPrescriptions(example.patient);
      assert(patient && rx);
      const callId = await control.startInboundCall();
      await store.appendRecord({ callId, actor: "system", kind: "safety", input: { check: "demo_history", fixture: marker, source: "scripted demo history" } });
      const lookup = await control.press(callId, "lookup_patient", {name: patient.firstName + " " + patient.lastName, dob:patient.dob, rx_number:rx.rxNumber});
      assert(lookup.ok && lookup.output.lookup_id, "Synthetic lookup failed.");
      const auth = await control.press(callId,"check_code",{lookup_id:lookup.output.lookup_id,code});
      assert(auth.ok && auth.output.verified, "Synthetic verification failed.");
      const caller = text => store.appendRecord({callId, actor:"caller", kind:"caller_line",input:{text}});
      await caller(example.text);
      const note = await control.press(callId,"note_for_pharmacist",{kind:example.kind,rx_id:rx.id,text:example.text});
      assert(note.ok && note.lane === "review", "Case was not sent to pharmacist review.");
      let booking;
      if (example.hours) {
        const slot = slots.find(s => s.id === marker + "_" + example.patient);
        assert(await store.reserveAppointment({slotId:slot.id,patientId:patient.id,bookedAt:meta.now}), "Example slot was taken.");
        await store.appendRecord({callId,actor:"system",kind:"safety",input:{check:"board_example_booking",fixture:marker,source:"scripted staff booking",slotId:slot.id}});
        booking = slot.label;
      }
      await control.endCall(callId);
      summary.push({ name: patient.firstName + " " + patient.lastName, booking });
    }
    return summary;
  });
  console.log(result);
} finally {await pool.end(); await vite.close();}
