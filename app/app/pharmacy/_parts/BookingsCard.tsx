import { Card, SectionHeader } from "@/components/ui";
import type { Store } from "@/lib/contract";
import { upcomingBookings } from "./bookings";

export async function Bookings({ store }: { store: Store }) {
  const rows = await upcomingBookings(store);
  return <Card as="section" aria-label="Upcoming pharmacist bookings">
    <SectionHeader title="Upcoming pharmacist bookings" />
    {rows.length ? <ul className="divide-y divide-line">
      {rows.map(row => <li key={row.slotId} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm">
        <span className="font-medium text-ink">{row.patient}</span><span className="text-ink-2">{row.label}</span>
      </li>)}
    </ul> : <p className="text-sm text-ink-3">No pharmacist consultations booked.</p>}
  </Card>;
}
