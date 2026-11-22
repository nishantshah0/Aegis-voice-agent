import { connection } from "next/server";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { DemoMenuButton } from "./DemoMenuButton";

// The demo's levers (reset, daily check, pairing the patient phone, the raw event feed),
// kept in one small menu in the top bar so the pages read as the product. The routes
// themselves decide who may use them; this only lists the patients for pairing.
export async function DemoMenu() {
  await connection();
  if (!(await getApprover())) return null;
  const patients = await getStore()
    .listPatients()
    .catch(() => []);
  return <DemoMenuButton patients={patients.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} />;
}
