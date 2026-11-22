// The dashboard's two product areas and their pages, hard-coded here so the area owners
// never edit the shell: Pharmacy calls (app/dashboard/calls/**, the calls-area agent) and
// the Safety suite (app/dashboard/suite/**, the suite-area agent).

export type IconName = "home" | "today" | "calendar" | "outreach" | "calls" | "review" | "gate" | "attack" | "flask" | "moon" | "book" | "phone" | "grid";
export type NavItem = { href: string; label: string; icon: IconName; hint: string };
export type Area = { key: "calls" | "suite"; label: string; short: string; home: string; items: NavItem[] };

export const DASHBOARD = "/dashboard";
export const OVERVIEW: NavItem = { href: DASHBOARD, label: "Overview", icon: "home", hint: "What needs you now" };

export const AREAS: Area[] = [
  {
    key: "calls",
    label: "Pharmacy calls",
    short: "Pharmacy",
    home: "/dashboard/calls",
    items: [
      { href: "/dashboard/calls", label: "Today", icon: "today", hint: "Approve what needs a pharmacist" },
      { href: "/dashboard/calls/upcoming", label: "Upcoming", icon: "calendar", hint: "Refills due in the next 14 days" },
      { href: "/dashboard/calls/outreach", label: "Outreach", icon: "outreach", hint: "Who we'll call, and when" },
      { href: "/dashboard/calls/history", label: "Calls", icon: "calls", hint: "Every call, press and line" },
      { href: "/dashboard/calls/review", label: "Review calls", icon: "review", hint: "Label finished calls" },
    ],
  },
  {
    key: "suite",
    label: "Safety suite",
    short: "Safety",
    home: "/dashboard/suite",
    items: [
      { href: "/dashboard/suite", label: "Overview", icon: "grid", hint: "The suite at a glance" },
      { href: "/dashboard/suite/live", label: "Live gate", icon: "gate", hint: "Every press and sentence, live" },
      { href: "/dashboard/suite/attacks", label: "Attacks", icon: "attack", hint: "Swap in a compromised AI" },
      { href: "/dashboard/suite/scenarios", label: "Scenarios", icon: "flask", hint: "The scripted test calls" },
      { href: "/dashboard/suite/overnight", label: "Overnight", icon: "moon", hint: "What the attackers tried" },
      { href: "/dashboard/suite/rules", label: "Rules", icon: "book", hint: "The buttons, speech rules and why" },
    ],
  },
];

export function areaFor(pathname: string): Area | undefined {
  return AREAS.find((a) => pathname === a.home || pathname.startsWith(`${a.home}/`));
}

/** Exact match for an area's home ("/dashboard/calls" is Today, not every calls page). */
export function isActive(pathname: string, href: string): boolean {
  const isHome = href === DASHBOARD || AREAS.some((a) => a.home === href);
  return isHome ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
