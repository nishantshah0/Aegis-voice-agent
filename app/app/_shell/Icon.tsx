import type { IconName } from "./nav";

// Line icons on a 20 px grid, drawn with currentColor. No icon font, no emoji.
const PATHS: Record<IconName, string> = {
  home: "M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1V9Z",
  today: "M4 4.5h12a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1ZM3 8h14M7 2.5v3M13 2.5v3M7.5 12l2 2 3.5-4",
  calendar: "M4 4.5h12a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1ZM3 8h14M7 2.5v3M13 2.5v3M6.5 11h1M9.5 11h1M12.5 11h1M6.5 14h1M9.5 14h1",
  outreach: "M3 10h3l1.5-3 3 6 1.5-3h5M14 4.5l2.5 2-2.5 2",
  badge: "M10.0 2.8 L12.1 7.7 L17.4 8.2 L13.4 11.7 L14.6 16.9 L10.0 14.2 L5.4 16.9 L6.6 11.7 L2.6 8.2 L7.9 7.7Z",
  calls: "M5.5 3h2.2l1.1 3.3-1.6 1.1a9 9 0 0 0 5.4 5.4l1.1-1.6 3.3 1.1v2.2A1.5 1.5 0 0 1 15.5 16 12.5 12.5 0 0 1 4 4.5 1.5 1.5 0 0 1 5.5 3Z",
  review: "M4 3.5h9l3 3V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1ZM6.5 10l2 2 4-4.5",
  gate: "M2.5 10h3l2-5 3 10 2-5h5",
  attack: "M11 2.5 4.5 11h5L9 17.5 15.5 9h-5L11 2.5Z",
  flask: "M8 2.5h4M8.5 2.5v5L4 15.2A1.2 1.2 0 0 0 5 17h10a1.2 1.2 0 0 0 1-1.8L11.5 7.5v-5M6 12.5h8",
  moon: "M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z",
  book: "M4 4a1.5 1.5 0 0 1 1.5-1.5H16V15H5.5A1.5 1.5 0 0 0 4 16.5V4ZM4 16.5A1.5 1.5 0 0 0 5.5 18H16M7.5 6.5h5",
  phone: "M6.5 2.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 15h2",
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className ?? "size-[18px]"} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
