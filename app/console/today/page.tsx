import { EventFeed } from "./EventFeed";

export const metadata = { title: "Today · Refill Guard" };

export default function TodayPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Lanes, the Review queue and approvals arrive in task 2.3. For now this shows the live event stream.
      </p>
      <EventFeed />
    </main>
  );
}
