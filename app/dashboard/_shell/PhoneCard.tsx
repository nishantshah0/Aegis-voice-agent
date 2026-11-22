import { connection } from "next/server";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { Icon } from "./Icon";
import { PairMini } from "./PairMini";

// The patient's phone is its own device (/phone), not a dashboard page: open it in a new
// tab, or pair it to a patient first. Patient names load only for a signed-in user.
export async function PhoneCard({ compact = false }: { compact?: boolean }) {
  await connection();
  const approver = await getApprover();
  const patients = approver ? (await getStore().listPatients()).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` })) : [];
  if (compact) {
    return (
      <div className="rounded-xl border border-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 whitespace-nowrap">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Icon name="phone" className="size-[18px] text-accent" /> Patient phone
          </p>
          <a href="/phone" target="_blank" rel="noopener" className="text-xs font-medium text-accent hover:underline">
            Open ↗
          </a>
        </div>
        {patients.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink">Pair a phone</summary>
            <div className="mt-2">
              <PairMini patients={patients} compact />
            </div>
          </details>
        )}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="phone" className="size-[18px] text-accent" /> Patient phone
        </p>
        <a href="/phone" target="_blank" rel="noopener" className="text-xs font-medium text-accent hover:underline">
          Open phone ↗
        </a>
      </div>
      <p className="mt-2 text-sm text-ink-2">The patient&apos;s side of the call, as its own device. Pair it to a patient, then open the link on that phone.</p>
      {patients.length > 0 && (
        <div className="mt-3">
          <PairMini patients={patients} />
        </div>
      )}
    </div>
  );
}
