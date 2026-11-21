#!/usr/bin/env node
// The build board: a live page showing how our four agents build Refill Guard with Entire.
//
//   node scripts/board.mjs [port]      then open http://localhost:4747
//
// It runs on your machine only. It reads the agent channel (GitHub issue #1) with your
// `gh` login, Trails, findings, Brain and Graph with your `entire` login, and commit
// history with git. Nothing is published, and it never reads session transcripts or prompts.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REPO = process.env.AGENT_CHANNEL_REPO || "nishantshah0/namereserve";
const ISSUE = process.env.AGENT_CHANNEL_ISSUE || "1";
const URGENT_ISSUE = process.env.AGENT_URGENT_ISSUE || "11";
const PROJECT = process.env.ENTIRE_PROJECT || "gh/" + REPO.split("/")[0];
const SESSIONS_REPO = process.env.ENTIRE_SESSIONS_REPO || `https://github.com/${REPO}-sessions.git`;
const PORT = Number(process.argv[2] || process.env.PORT || 4747);

const HEADER = /^\[(?:ROLE-(\d)|HUMAN) · (?:([A-Z]+) → ([A-Z0-9-]+)|([A-Z0-9-]+))\] *(.*)$/;
const TRAIL_REF = /(?:[Tt]rail\s*#\s*|\/trails\/)(\d+)/g;

function run(cmd, args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout, env: { ...process.env, NO_COLOR: "1" } },
      (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim().split("\n").slice(-2).join(" "))) : resolve(out)));
  });
}
const runJson = async (cmd, args, opts) => JSON.parse(await run(cmd, args, opts));

// Cache each source separately, so one slow or failing source never blocks the others.
const caches = new Map();
function cached(key, ms, fn) {
  const c = caches.get(key);
  if (c && Date.now() - c.at < ms) return c.p;
  const p = fn().catch((e) => ({ error: e.message }));
  caches.set(key, { at: Date.now(), p });
  return p;
}

// ---------- The agent channel ----------
function parse(c) {
  const [first, ...rest] = c.body.split("\n");
  const m = first.match(HEADER);
  const details = rest.join("\n").trim();
  if (!m) return { ...c, from: "?", type: "NOTE", to: "ALL", summary: first, details };
  // ROLE-0 is Nishant's tools agent, not a person, so it gets its own lane ("TOOLS").
  const human = !m[1];
  const from = human ? "HUMAN" : m[1] === "0" ? "TOOLS" : `ROLE-${m[1]}`;
  return {
    ...c,
    from,
    type: human && !m[2] ? "HUMAN" : m[2],
    to: (m[3] || m[4]).replace(/^ROLE-0$/, "TOOLS"),
    summary: m[5],
    details,
  };
}
const channel = () => cached("channel", 8000, async () => {
  const jq = ".[] | {id, t: .created_at, u: .user.login, url: .html_url, body}";
  const read = async (issue, urgent) => (await run("gh", ["api", `repos/${REPO}/issues/${issue}/comments?per_page=100`, "--paginate", "--jq", jq]).catch((e) => (urgent ? "" : Promise.reject(e))))
    .split("\n").filter(Boolean).map((l) => ({ ...parse(JSON.parse(l)), urgent }));
  const [normal, urgent] = await Promise.all([read(ISSUE, false), read(URGENT_ISSUE, true)]);
  const messages = [...normal, ...urgent].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { repo: REPO, issue: ISSUE, urgentIssue: URGENT_ISSUE, messages };
});

// ---------- The plan: every task from docs/TASKS.md ----------
// Submission deadline for the countdown (Sun Nov 22, 9:00 AM Eastern). Override with BOARD_DEADLINE.
const DEADLINE = process.env.BOARD_DEADLINE || "2026-11-22T09:00:00-05:00";
const tasks = () => cached("tasks", 60000, async () => {
  // Read main's copy, so the board tracks the plan everyone works from.
  const md = await run("git", ["show", "origin/main:docs/TASKS.md"]).catch(() => readFileSync(join(ROOT, "docs/TASKS.md"), "utf8"));
  const list = [];
  let role = null, core = true;
  for (const line of md.split("\n")) {
    const h = line.match(/^## Role (\d)/);
    if (h) { role = h[1]; core = true; continue; }
    if (/^## /.test(line)) { role = null; continue; }
    if (!role) continue;
    if (/\*\*After core\*\*/.test(line)) { core = false; continue; }
    // Table rows look like: | 1.2 | **Typed agent loop:** ... | Done when | Needs |
    const r = line.match(/^\|\s*(\d\.\d+)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|/);
    if (!r) continue;
    // A struck-out title marked "**Done**" (like 2.5) was settled in the plan itself.
    const struck = r[2].match(/^~~(.+?)~~/);
    const bold = r[2].match(/^\*\*(.+?)\*\*/);
    const title = (struck ? struck[1] : bold ? bold[1] : r[2]).replace(/[*`]/g, "").replace(/[:.]\s*$/, "").trim();
    const done = Boolean(struck) && /\*\*Done/.test(r[2]);
    list.push({ id: r[1], role: "ROLE-" + role, core, title, done, doneWhen: r[3].replace(/[*`]/g, "") });
  }
  return { tasks: list, deadline: DEADLINE };
});

// ---------- Trails and findings ----------
async function trailNumbers() {
  // The owner can list every Trail. Teammates can't on a personal repo, so fall back to
  // every "Trail #n" mentioned on the channel and open each one by number.
  try {
    const list = await runJson("entire", ["trail", "list", "--project", PROJECT, "--json", "--limit", "100"]);
    if (list.items?.length) return list.items.map((t) => t.number);
  } catch {}
  const ch = await channel();
  const nums = new Set();
  for (const m of ch.messages || []) for (const x of m.body.matchAll(TRAIL_REF)) nums.add(Number(x[1]));
  return [...nums];
}
async function oneTrail(n) {
  const t = await runJson("entire", ["trail", "show", String(n), "--project", PROJECT, "--json"]);
  let findings = { counts: {}, findings: [] };
  try {
    findings = await runJson("entire", ["trail", "finding", "list", "--trail", String(n), "--project", PROJECT, "--status", "any", "--freshness", "any", "--json"]);
  } catch {}
  return {
    number: t.number, title: t.title, body: t.body, status: t.status, phase: t.phase, type: t.type,
    url: t.url || `https://entire.com/${PROJECT}/-/trails/${t.number}`,
    createdAt: t.createdAt, lastActivityAt: t.lastActivityAt, closedAt: t.closedAt,
    changes: (t.changes || []).map((c) => ({ branch: c.branch, base: c.base, status: c.status, url: c.url, updatedAt: c.updatedAt })),
    findings: (findings.findings || []).map((f) => ({
      title: f.title || f.summary || (f.body || "").split("\n")[0], severity: f.severity, status: f.status,
      path: f.path || f.file || f.location?.path, createdAt: f.createdAt || f.created_at,
    })),
    findingCounts: findings.counts || {},
  };
}
const trails = () => cached("trails", 45000, async () => {
  const nums = await trailNumbers();
  const all = await Promise.all(nums.map((n) => oneTrail(n).catch(() => null)));
  for (const t of all.filter(Boolean)) {
    for (const c of t.changes) c.shas = await branchCommits(c.branch);
  }
  return { project: PROJECT, trails: all.filter(Boolean).sort((a, b) => b.number - a.number) };
});

// ---------- Commits linked to AI sessions (Entire-Checkpoint trailers) ----------
const commits = () => cached("commits", 30000, async () => {
  await run("git", ["fetch", "-q", "origin"], { timeout: 30000 }).catch(() => {});
  const fmt = "%H%x1f%an%x1f%aI%x1f%s%x1f%(trailers:key=Entire-Checkpoint,valueonly,separator=%x2C)%x1f%S%x1e";
  const out = await run("git", ["log", "--remotes=origin", "--no-merges", "--source", "--max-count=400", `--format=${fmt}`]);
  const list = out.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, author, date, subject, cp, source] = r.split("\x1f");
    return { sha, author, date, subject, checkpoints: cp ? cp.split(",").map((s) => s.trim()).filter(Boolean) : [], branch: (source || "").replace(/^refs\/remotes\/origin\//, "") };
  });
  let recorded = [];
  try {
    const refs = await run("git", ["ls-remote", SESSIONS_REPO, "refs/entire/checkpoints/*"], { timeout: 30000 });
    recorded = refs.split("\n").map((l) => l.split("/").pop()).filter(Boolean);
  } catch {}
  const branches = (await run("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]).catch(() => ""))
    .split("\n").filter((b) => b && !b.endsWith("/HEAD")).map((b) => b.replace(/^origin\//, ""));
  // Branches merged into main, from the merge commits ("Merge role-2/x: ..." or "Merge pull request #4 from owner/role-3/y").
  // Some merges happen as GitHub PRs with no MERGED message, so the plan view needs these too.
  const mergeSubjects = lines(await run("git", ["log", "origin/main", "--merges", "--format=%s"]).catch(() => ""));
  const merged = mergeSubjects.filter((s) => !/ into /.test(s)).map((s) => {
    const pr = s.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/);
    const plain = s.match(/^Merge ([\w./-]+)/);
    return { branch: pr ? pr[1] : plain ? plain[1] : "", subject: s };
  }).filter((m) => m.branch);
  return { repo: REPO, commits: list, recorded, branches, merged };
});

// Which commits are on each Trail's branch (so a Trail card can show the AI work behind it).
const lines = (out) => out.split("\n").map((l) => l.trim()).filter(Boolean);
const branchCommits = (branch) => cached("bc:" + branch, 120000, async () => {
  const tip = (await run("git", ["rev-parse", "--verify", "-q", `origin/${branch}`]).catch(() => "")).trim();
  if (!tip) return [];
  const open = lines(await run("git", ["log", tip, "--not", "origin/main", "--no-merges", "--format=%H"]).catch(() => ""));
  if (open.length) return open;
  // Merged: find the merge on main that brought the tip in, and take what that merge added.
  const merges = lines(await run("git", ["rev-list", "--first-parent", "--merges", "--parents", "-n", "80", "origin/main"]).catch(() => ""));
  for (const m of merges) {
    const [, p1, p2] = m.split(" ");
    if (!p2) continue;
    const inIt = await run("git", ["merge-base", "--is-ancestor", tip, p2]).then(() => true, () => false);
    if (inIt) return lines(await run("git", ["log", p2, "--not", p1, "--no-merges", "--format=%H"]).catch(() => ""));
  }
  return [];
});

// ---------- Brain and Graph ----------
const brain = () => cached("brain", 60000, async () => {
  const [status, recall] = await Promise.all([
    runJson("entire", ["brain", "status", "--json"]).catch(() => ({})),
    runJson("entire", ["brain", "recall", "decision convention invariant rule never always must api agent store events contract guard", "--json", "--k", "128"]).catch(() => ({ facts: [] })),
  ]);
  const facts = (recall.facts || []).filter((f) => f.status !== "retracted").map((f) => ({
    id: f.id, text: f.text, kind: f.kind, path: (f.paths || [])[0] || "", branch: f.branch,
    commit: f.provenance?.find((p) => p.commit)?.commit || "", createdAt: f.created_at,
  }));
  return {
    memories: status.facts?.facts ?? facts.length,
    docs: status.retrieval?.docs_records ?? null,
    shared: status.hosted?.state === "connected",
    sources: status.sources || {},
    facts: facts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
});
const graph = () => cached("graph", 120000, async () => {
  const out = await run("entire", ["graph", "health", "--json"], { timeout: 120000 });
  const h = JSON.parse(out.slice(out.indexOf("{")));
  return { commit: h.commit, counts: h.counts, languages: h.completeness?.languages || {}, relations: h.completeness?.relations || {} };
});
const checkpointChanges = (id) => cached("cp:" + id, 600000, async () => {
  const out = await run("entire", ["graph", "checkpoint", id, "--json"], { timeout: 60000 });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return {
    files: (j.files || []).map((f) => ({
      path: f.path, status: f.status, language: f.language,
      changes: (f.changes || []).map((c) => ({ type: c.type, kind: c.kind, name: c.name, dependents: c.dependents_count })),
    })),
  };
});

// ---------- HTTP ----------
const PAGE_PATH = join(HERE, "board.html");
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/") return send(res, 200, readFileSync(PAGE_PATH, "utf8"), "text/html; charset=utf-8");
    if (url.pathname === "/api/messages") {
      const ch = await channel();
      return ch.error ? send(res, 502, { error: `gh couldn't read the channel: ${ch.error}` }) : send(res, 200, ch);
    }
    if (url.pathname === "/api/tasks") return send(res, 200, await tasks());
    if (url.pathname === "/api/trails") return send(res, 200, await trails());
    if (url.pathname === "/api/commits") return send(res, 200, await commits());
    if (url.pathname === "/api/brain") return send(res, 200, await brain());
    if (url.pathname === "/api/graph") return send(res, 200, await graph());
    if (url.pathname === "/api/branch") {
      const b = url.searchParams.get("b") || "";
      if (!/^[\w./-]+$/.test(b)) return send(res, 400, { error: "bad branch" });
      return send(res, 200, { branch: b, shas: await branchCommits(b) });
    }
    const cp = url.pathname.match(/^\/api\/checkpoint\/([0-9A-Z]{26})$/);
    if (cp) return send(res, 200, await checkpointChanges(cp[1]));
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Build board: http://localhost:${PORT}  (channel ${REPO}#${ISSUE}, Entire project ${PROJECT})`);
});
