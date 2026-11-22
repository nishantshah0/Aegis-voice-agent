// The app's two product areas and their pages. One list drives the sidebar, the area
// switcher and the overview's quick links.

export type IconName = "home" | "today" | "calendar" | "outreach" | "calls" | "review" | "gate" | "attack" | "flask" | "moon" | "book" | "phone" | "badge" | "chevrons" | "sliders" | "signout" | "check" | "external" | "feed";
export type NavItem = { href: string; label: string; icon: IconName; hint: string; hosted?: boolean };
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
      { href: "/app/pharmacy/phone", label: "Phone", icon: "phone", hint: "Talk in the browser or call the test handset", hosted: true },
      { href: "/app/pharmacy/upcoming", label: "Upcoming", icon: "calendar", hint: "Refills due in the next 14 days" },
      { href: "/app/pharmacy/outreach", label: "Outreach", icon: "outreach", hint: "Who we'll call, and when" },
      { href: "/app/pharmacy/calls", label: "Calls", icon: "calls", hint: "Every call, press and line" },
      { href: "/app/pharmacy/review", label: "Call quality", icon: "review", hint: "Label finished calls" },
    ],
  },
  {
    key: "safety",
    label: "Safety suite",
    short: "Safety",
    home: "/app/safety",
    hint: "Release readiness, test runs and their evidence",
    items: [
      { href: "/app/safety", label: "Overview", icon: "badge", hint: "Release readiness and failures needing attention" },
      { href: "/app/safety/gate-report", label: "Release gate", icon: "check", hint: "Saved required checks and release evidence" },
      { href: "/app/safety/business-tests", label: "Business tests", icon: "flask", hint: "Run synthetic workflows and review results", hosted: true },
      { href: "/app/safety/scenarios", label: "Scenarios", icon: "flask", hint: "Scripted test calls and their evidence" },
      { href: "/app/safety/attacks", label: "Attack library", icon: "attack", hint: "Attack cases, saved batches and coverage" },
      { href: "/app/safety/evals", label: "Evals", icon: "review", hint: "Compare results by test layer" },
      { href: "/app/safety/overnight", label: "Overnight", icon: "moon", hint: "Review gaps from saved overnight runs" },
      { href: "/app/safety/live-calls", label: "Live calls", icon: "calls", hint: "Run simulated attacker calls" },
      { href: "/app/safety/gate", label: "Live gate", icon: "gate", hint: "Watch active call events from the record" },
      { href: "/app/safety/rules", label: "Rules", icon: "book", hint: "The 12 buttons, speech rules and why" },
      { href: "/app/safety/rule-writer", label: "Rule writer", icon: "feed", hint: "Write a rule, a pharmacist approves" },
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
