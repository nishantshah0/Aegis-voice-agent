import type { ResetResponse } from "@/lib/contract";
import { emit } from "@/lib/events";
import { SEED } from "@/lib/seed";
import { demoControlsRefused } from "../../_lib/demo";
import { ok } from "../../_lib/http";
import { getStore } from "../../_lib/runtime";

// POST /api/demo/reset → { now }
// Reseeds the store (calls, new orders, queue and record cleared) and sets the
// demo clock to the seed's Tuesday 10 AM, then tells every page the time.
export async function POST() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const store = getStore();
  await store.reset(SEED);
  const now = await store.now();
  emit({ type: "clock", now });
  const res: ResetResponse = { now };
  return ok(res);
}
