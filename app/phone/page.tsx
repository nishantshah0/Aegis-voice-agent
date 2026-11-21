import { Phone } from "./Phone";

export const metadata = { title: "Phone · Refill Guard" };

// The patient's phone (task 1.4): rings for the daily check's call, shows the code,
// the conversation and the refill's status. Driven only by /api/events.
export default function PhonePage() {
  return (
    <main className="min-h-screen bg-neutral-100 p-6 dark:bg-neutral-900">
      <Phone />
    </main>
  );
}
