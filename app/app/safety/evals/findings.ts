// Real gaps our tests found on 2026-11-21 and 22, and the commits that fixed them. Every hash
// here is a commit on main (checked with git when this list was written); nothing is
// paraphrased beyond the commit's own subject.

export const REPO = "https://github.com/nishantshah0/Aegis-voice-agent";
export const commitUrl = (sha: string) => `${REPO}/commit/${sha}`;
export const trailUrl = (n: number) => `https://entire.com/gh/nishantshah0/-/trails/${n}`;

export type Finding = {
  title: string;
  /** Which test layer found it. */
  foundBy: string;
  fix: string;
  commits: { sha: string; label: string }[];
  link: { label: string; href: string };
};

export const FINDINGS: Finding[] = [
  {
    title: "The speech guard (S4) blocked honest lines",
    foundBy: "Live demo passes on the real agent",
    fix: "\"I can't say yet when it will be ready\", offers like \"I can check whether it's ready\", and \"your code is confirmed\" were replaced as if they were promises. Five rounds narrowed S4 to real promises the record doesn't back.",
    commits: [
      { sha: "968f06b", label: "can't say yet" },
      { sha: "ba17404", label: "no ready time" },
      { sha: "c895a47", label: "questions" },
      { sha: "f9ec386", label: "offers" },
      { sha: "26db488", label: "identity" },
    ],
    link: { label: "Trail #27", href: trailUrl(27) },
  },
  {
    title: "A scorer counted a step that never happened as a broken rule",
    foundBy: "Reading a scenario run's transcript in this suite",
    fix: "A 'before' check (verify, then change the delivery) failed as 'broken' when the agent never changed the delivery at all. Now that's a missed outcome, and only doing it out of order breaks the rule.",
    commits: [
      { sha: "b702cdb", label: "test" },
      { sha: "11a43a3", label: "fix" },
    ],
    link: { label: "Trail #60", href: trailUrl(60) },
  },
  {
    title: "The phone couldn't voice the line said in place of a blocked one",
    foundBy: "Role 3's source audit",
    fix: "The speak route only voiced lines the agent said, so the guard's replacement got a 403 and the phone fell back to the browser voice. It now voices the replacement, never the blocked original.",
    commits: [
      { sha: "b28bd51", label: "test" },
      { sha: "60e22bc", label: "fix" },
    ],
    link: { label: "Trail #71", href: trailUrl(71) },
  },
  {
    title: "Hijack batch calls shared call ids with real calls",
    foundBy: "Code review of the stage",
    fix: "Each batch call is now tagged hijack_<run>_<card>, so the projector never mixes an attack with a patient's call.",
    commits: [{ sha: "963c6aa", label: "fix" }],
    link: { label: "Trail #14", href: trailUrl(14) },
  },
  {
    title: "A live attack call could read as ended before it was saved",
    foundBy: "The test suite, under load",
    fix: "The call is now saved and frees its slot before anyone can see it as ended.",
    commits: [{ sha: "abaebed", label: "fix" }],
    link: { label: "Trail #69", href: trailUrl(69) },
  },
  {
    title: "Running the tests with the database URL set would reset the demo database",
    foundBy: "Reviewing the test harness",
    fix: "Tests now clear the database URL before anything loads, and the reset refuses a real database unless told explicitly.",
    commits: [
      { sha: "7d3238f", label: "test" },
      { sha: "0d63d30", label: "fix" },
    ],
    link: { label: "URGENT #11", href: `${REPO}/issues/11` },
  },
];
