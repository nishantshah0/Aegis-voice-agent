import type { ResetResponse } from "@/lib/contract";
import { emit } from "@/lib/events";
import { demoControlsRefused } from "../../_lib/demo";
import { clearPhoneTokens } from "../../_lib/phone";
import { ok } from "../../_lib/http";
import { forgetCalls, getStore, localDemoSeed } from "../../_lib/runtime";

// POST /api/demo/reset → { now }
// Reseeds the store (calls, new orders, queue and record cleared) and sets the
// demo clock to the seed's Tuesday 10 AM, then tells every page the time. Open calls are
// hung up first, and the agent starts fresh, so no new call inherits an old conversation.
export async function POST() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  await forgetCalls();
  const store = getStore();
  await store.reset(localDemoSeed());
  clearPhoneTokens(); // Call ids start again from c_0001.
  const now = await store.now();
  emit({ type: "clock", now });
  const res: ResetResponse = { now };
  return ok(res);
}
