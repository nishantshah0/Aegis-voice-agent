import { refuseUnlessPharmacist, refuseUnlessStaff } from "../../_lib/arena-runs";
import { fail, ok, readObject } from "../../_lib/http";
import { listCustomAttacks, parseAttack, patientChoices, saveCustomAttack, TACTICS } from "../../_lib/live-calls";

// GET /api/arena/custom → { attacks, patients, tactics }: custom attacks saved under
// results/arena/custom/ (not scenarios/, which is Role 3's), and what the form offers.
export async function GET() {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  return ok({
    attacks: await listCustomAttacks(),
    patients: patientChoices(),
    tactics: Object.entries(TACTICS).map(([key, t]) => ({ key, label: t.label })),
  });
}

// POST /api/arena/custom { title, goal, tactic, seed, direction, turns } → 201 { id, attack }. Pharmacist only.
export async function POST(request: Request) {
  const refused = await refuseUnlessPharmacist();
  if (refused) return refused;
  const attack = parseAttack(await readObject(request));
  if (typeof attack === "string") return fail(400, attack);
  return ok({ id: await saveCustomAttack(attack), attack }, 201);
}
