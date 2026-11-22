import type { Store } from "@/lib/contract";

export async function upcomingBookings(store: Store) {
  const [bookings, policy, now] = await Promise.all([store.listAppointments(), store.policy(), store.now()]);
  const reserved = new Map(bookings.map(row => [row.slotId, row.patientId]));
  const slots = (policy.appointmentSlots ?? [])
    .filter(slot => reserved.has(slot.id) && Date.parse(slot.start) > Date.parse(now))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return Promise.all(slots.map(async slot => {
    const patient = await store.getPatient(reserved.get(slot.id)!);
    const demo = process.env.PATIENT_SIMULATION === "community-demo" && !process.env.DATABASE_URL;
    const label = patient && (demo ? patient.firstName + " " + patient.lastName : patient.firstName[0] + "." + patient.lastName[0] + ".");
    return {slotId: slot.id, label: slot.label, patient: label || "Unknown patient"};
  }));
}
