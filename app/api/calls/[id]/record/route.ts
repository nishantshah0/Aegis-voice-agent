import { connection } from "next/server";
import type { CallRecordResponse, RecordEntry } from "@/lib/contract";
import { getApprover } from "@/lib/auth/session";
import { fail, ok } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

// GET /api/calls/:id/record → { entries, headHash }
// The call's record entries in order, and the hash of the newest entry in the whole
// record, so an export can be checked against the chain later. Signed-in pharmacist
// or reviewer only: the record holds patient details.
// Button entries go out without the control layer's `output.internal` (matched patient,
// code hashes): a codeHash is an unsalted sha256 over 10^6 codes, so it would give away a
// live code. headHash still comes from the stored chain, so the export can be checked.
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]/record">) {
  await connection();
  if (!(await getApprover())) return fail(401, "Sign in to read the record");
  const { id } = await ctx.params;
  const store = getStore();
  if (!(await store.getCall(id))) return fail(404, "No such call");
  const [entries, all] = await Promise.all([store.listRecord(id), store.listRecord()]);
  const res: CallRecordResponse = {
    entries: [...entries].sort((a, b) => a.seq - b.seq).map(withoutInternal),
    headHash: all.length > 0 ? all[all.length - 1].hash : "",
  };
  return ok(res);
}

function withoutInternal(entry: RecordEntry): RecordEntry {
  if (typeof entry.output !== "object" || entry.output === null || !("internal" in entry.output)) return entry;
  const output: Record<string, unknown> = { ...entry.output };
  delete output.internal;
  return { ...entry, output };
}
