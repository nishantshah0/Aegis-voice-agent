// The app's two product areas and their pages. One list drives the sidebar, the area
// switcher and the overview's quick links.

export type IconName = "home" | "today" | "calendar" | "outreach" | "calls" | "review" | "gate" | "attack" | "flask" | "moon" | "book" | "phone" | "badge" | "chevrons" | "sliders" | "signout" | "check" | "external" | "feed";
export type NavItem = { href: string; label: string; icon: IconName; hint: string };
export type Area = { key: "pharmacy" | "safety"; label: string; short: string; home: string; hint: string; items: NavItem[] };

export const OVERVIEW: NavItem = { href: "/app", label: "Home", icon: "home", hint: "What needs you now" };

export const AREAS: Area[] = [
  {
    key: "pharmacy",
    label: "Pharmacy calls",
    short: "Pharmacy",
    home: "/app/pharmacy/today",
    hint: "Refill calls and what needs a pharmacist",
    items: [
      { href: "/app/pharmacy/today", label: "Today", icon: "today", hint: "Approve what needs a pharmacist" },
      { href: "/app/pharmacy/upcoming", label: "Upcoming", icon: "calendar", hint: "Refills due in the next 14 days" },
      { href: "/app/pharmacy/outreach", label: "Outreach", icon: "outreach", hint: "Who we'll call, and when" },
      { href: "/app/pharmacy/calls", label: "Calls", icon: "calls", hint: "Every call, press and line" },
      { href: "/app/pharmacy/review", label: "Review calls", icon: "review", hint: "Label finished calls" },
    ],
  },
  {
    key: "safety",
    label: "Safety suite",
    short: "Safety",
    home: "/app/safety",
    hint: "Attacks, scenarios and the rules that hold",
    items: [
      { href: "/app/safety", label: "Overview", icon: "badge", hint: "Rules broken and the latest runs" },
      { href: "/app/safety/gate", label: "Live gate", icon: "gate", hint: "Every press and sentence, live" },
      { href: "/app/safety/live-calls", label: "Live calls", icon: "calls", hint: "An attacker AI rings the real agent" },
      { href: "/app/safety/attacks", label: "Attacks", icon: "attack", hint: "Swap in a compromised AI" },
      { href: "/app/safety/scenarios", label: "Scenarios", icon: "flask", hint: "The scripted test calls" },
      { href: "/app/safety/overnight", label: "Overnight", icon: "moon", hint: "What the attackers tried" },
      { href: "/app/safety/rules", label: "Rules", icon: "book", hint: "The buttons, speech rules and why" },
    ],
  },
];

/** Exact match for the overview and each area's home ("/app/safety" is the suite overview,
 * not every safety page); prefix match for the rest. */
export function isActivePath(pathname: string, href: string): boolean {
  const exact = href === OVERVIEW.href || AREAS.some((a) => a.home === href);
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function areaFor(pathname: string): Area | undefined {
  return AREAS.find((a) => pathname.startsWith(`/app/${a.key}`));
}

/** The page the path is on, for the top bar: the deepest nav item that matches. */
export function pageFor(pathname: string): NavItem | undefined {
  if (pathname === OVERVIEW.href) return OVERVIEW;
  const items = areaFor(pathname)?.items ?? [];
  return [...items].sort((a, b) => b.href.length - a.href.length).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}
