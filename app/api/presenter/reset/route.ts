import { emit } from "@/lib/events";
import { fail, ok, readObject } from "../../_lib/http";
import { clearPhoneTokens } from "../../_lib/phone";
import { forgetCalls, getStore, localDemoSeed } from "../../_lib/runtime";
import { forgetDemoClock } from "../agent/agent";
import { presenter } from "../phone/config";

// POST /api/presenter/reset { confirm: "reset" } → { now }   (Trail #70)
// The presenter's emergency Reset demo, between judges: the same reset as /api/demo/reset
// (open calls hung up, the store reseeded, the demo clock back to the seed's Tuesday 10 AM),
// for the signed-in presenter only, and only with an explicit confirm.
export async function POST(request: Request) {
  const denied = presenter(request);
  if (denied) return denied;
  const body = await readObject(request);
  if (body?.confirm !== "reset") return fail(400, 'Confirm with { "confirm": "reset" }');
  await forgetCalls();
  const store = getStore();
  await store.reset(localDemoSeed());
  clearPhoneTokens();
  await forgetDemoClock().catch(() => {});
  const now = await store.now();
  emit({ type: "clock", now });
  return ok({ now });
}
