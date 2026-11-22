// The app's two product areas and their pages. One list drives the sidebar, the area
// switcher and the overview's quick links.

export type IconName = "home" | "today" | "calendar" | "calls" | "review" | "gate" | "attack" | "flask" | "moon" | "book" | "phone";
export type NavItem = { href: string; label: string; icon: IconName; hint: string };
export type Area = { key: "pharmacy" | "safety"; label: string; short: string; home: string; items: NavItem[] };

export const OVERVIEW: NavItem = { href: "/app", label: "Overview", icon: "home", hint: "What needs you now" };

export const AREAS: Area[] = [
  {
    key: "pharmacy",
    label: "Pharmacy calls",
    short: "Pharmacy",
    home: "/app/pharmacy/today",
    items: [
      { href: "/app/pharmacy/today", label: "Today", icon: "today", hint: "Approve what needs a pharmacist" },
      { href: "/app/pharmacy/upcoming", label: "Upcoming", icon: "calendar", hint: "Refills due in the next 14 days" },
      { href: "/app/pharmacy/calls", label: "Calls", icon: "calls", hint: "Every call, press and line" },
      { href: "/app/pharmacy/review", label: "Review calls", icon: "review", hint: "Label finished calls" },
    ],
  },
  {
    key: "safety",
    label: "Safety suite",
    short: "Safety",
    home: "/app/safety/gate",
    items: [
      { href: "/app/safety/gate", label: "Live gate", icon: "gate", hint: "Every press and sentence, live" },
      { href: "/app/safety/attacks", label: "Attacks", icon: "attack", hint: "Swap in a compromised AI" },
      { href: "/app/safety/scenarios", label: "Scenarios", icon: "flask", hint: "The scripted test calls" },
      { href: "/app/safety/overnight", label: "Overnight", icon: "moon", hint: "What the attackers tried" },
      { href: "/app/safety/rules", label: "Rules", icon: "book", hint: "The buttons, speech rules and why" },
    ],
  },
];

export function areaFor(pathname: string): Area | undefined {
  return AREAS.find((a) => pathname.startsWith(`/app/${a.key}`));
}
