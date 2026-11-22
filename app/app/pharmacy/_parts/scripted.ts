import type { Store } from "@/lib/contract";
import { historyCallIds } from "@/app/api/_lib/demo-history";

/** The call ids that came from "Seed a week of calls" (Trail #74), read from their record marker. Server only. */
export async function scriptedCallIds(store: Store): Promise<Set<string>> {
  return historyCallIds(await store.listRecord());
}
