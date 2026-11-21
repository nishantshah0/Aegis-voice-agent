#!/usr/bin/env node
// A live page for watching the agents talk on the agent channel (GitHub issue #1).
//
//   node scripts/channel-view.mjs [port]      then open http://localhost:4747
//
// Runs on your machine only and reads the channel with your own `gh` login, so the
// private repo stays private. No dependencies, no tokens, nothing to host.
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const REPO = process.env.AGENT_CHANNEL_REPO || "nishantshah0/namereserve";
const ISSUE = process.env.AGENT_CHANNEL_ISSUE || "1";
const PORT = Number(process.argv[2] || process.env.PORT || 4747);
const CACHE_MS = 8000;

const HEADER = /^\[(?:ROLE-(\d)|HUMAN) · (?:([A-Z]+) → ([A-Z0-9-]+)|([A-Z0-9-]+))\] *(.*)$/;

function parse(c) {
  const [first, ...rest] = c.body.split("\n");
  const m = first.match(HEADER);
  const details = rest.join("\n").trim();
  if (!m) return { ...c, from: "?", type: "NOTE", to: "ALL", summary: first, details };
  const human = !m[1] || m[1] === "0";
  return {
    ...c,
    from: human ? "HUMAN" : `ROLE-${m[1]}`,
    type: human && !m[2] ? "HUMAN" : m[2],
    to: (m[3] || m[4]).replace(/^ROLE-0$/, "HUMAN"),
    summary: m[5],
    details,
  };
}

let cache = { at: 0, data: null };
function fetchMessages() {
  if (Date.now() - cache.at < CACHE_MS && cache.data) return Promise.resolve(cache.data);
  const jq = ".[] | {id, t: .created_at, u: .user.login, url: .html_url, body}";
  const args = ["api", `repos/${REPO}/issues/${ISSUE}/comments?per_page=100`, "--paginate", "--jq", jq];
  return new Promise((resolve, reject) => {
    execFile("gh", args, { maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) return reject(new Error((errOut || err.message).trim()));
      const messages = out.split("\n").filter(Boolean).map((l) => parse(JSON.parse(l)));
      cache = { at: Date.now(), data: { repo: REPO, issue: ISSUE, messages } };
      resolve(cache.data);
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.url === "/api/messages") {
    try {
      const data = await fetchMessages();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `gh couldn't read the channel: ${e.message}` }));
    }
    return;
  }
  if (req.url === "/" || req.url.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Agent channel viewer: http://localhost:${PORT}  (reading ${REPO}#${ISSUE} with gh)`);
});

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent channel · Refill Guard</title>
<style>
  :root {
    --bg: #0d1117; --panel: #151b23; --panel2: #1b222c; --line: #2a3340; --text: #e6edf3; --muted: #8b97a6;
    --r1: #4ea1ff; --r2: #3fb68b; --r3: #f2706b; --r4: #c79bff; --human: #f5b94a; --all: #8b97a6;
    --radius: 12px;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f6f7f9; --panel: #fff; --panel2: #f1f3f6; --line: #dfe3e8; --text: #1b2330; --muted: #5d6877;
      --r1: #1f6fd6; --r2: #13875f; --r3: #d2423c; --r4: #7c4fd0; --human: #b77800; --all: #6b7684; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 14px; padding: 12px 20px;
    background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; font-weight: 650; }
  header .sub { color: var(--muted); font-size: 13px; }
  .live { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; margin-left: auto; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--r2); box-shadow: 0 0 0 0 var(--r2); animation: pulse 2s infinite; }
  .dot.err { background: var(--r3); animation: none; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--r2) 60%, transparent); } 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
  .state { font-weight: 700; font-size: 12px; padding: 3px 9px; border-radius: 999px; letter-spacing: .04em; }
  .state.go { background: color-mix(in srgb, var(--r2) 18%, transparent); color: var(--r2); }
  .state.stop { background: color-mix(in srgb, var(--r3) 22%, transparent); color: var(--r3); }
  a { color: inherit; }
  main { display: grid; grid-template-columns: 300px minmax(0, 1fr) 320px; gap: 16px; padding: 16px 20px 40px; max-width: 1500px; margin: 0 auto; }
  @media (max-width: 1150px) { main { grid-template-columns: 280px minmax(0, 1fr); } .right { grid-column: 1 / -1; } }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; margin-bottom: 16px; }
  .panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 10px; font-weight: 650; }
  .role { display: block; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--panel2); color: var(--text);
    border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; border-left: 4px solid var(--c); font: inherit; }
  .role:hover { border-color: var(--c); }
  .role.on { outline: 2px solid var(--c); outline-offset: 1px; }
  .role .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .role .name { font-weight: 650; }
  .role .n { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .role .doing { color: var(--muted); font-size: 12.5px; margin-top: 4px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .role .doing b { color: var(--text); font-weight: 550; }
  svg text { fill: var(--text); font-size: 11px; font-weight: 600; }
  svg .cnt { fill: var(--muted); font-size: 10px; font-weight: 500; }
  .edge { fill: none; stroke-linecap: round; opacity: .55; transition: opacity .2s; }
  .edge.dim { opacity: .08; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px; }
  .chip { border: 1px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 999px; padding: 4px 10px; font: 600 11.5px/1.2 inherit; cursor: pointer; letter-spacing: .03em; }
  .chip.on { color: var(--text); border-color: var(--text); }
  .search { flex: 1 1 180px; min-width: 140px; border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 999px; padding: 6px 12px; font: inherit; }
  .msg { position: relative; background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: var(--radius); padding: 11px 14px; margin-bottom: 10px; }
  .msg.new { animation: flash 2.5s ease-out; }
  @keyframes flash { from { background: color-mix(in srgb, var(--c) 22%, var(--panel)); } to { background: var(--panel); } }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .who { font-weight: 700; color: var(--c); }
  .arrow { color: var(--muted); }
  .to { font-weight: 650; color: var(--tc); }
  .type { font-weight: 700; font-size: 10.5px; letter-spacing: .06em; padding: 2px 7px; border-radius: 5px; background: var(--panel2); color: var(--text); border: 1px solid var(--line); }
  .type.HUMAN, .type.STOP { background: color-mix(in srgb, var(--human) 20%, transparent); color: var(--human); border-color: transparent; }
  .type.DECISION, .type.OBJECT { background: color-mix(in srgb, var(--r4) 18%, transparent); color: var(--r4); border-color: transparent; }
  .type.HANDOFF, .type.MERGED { background: color-mix(in srgb, var(--r2) 18%, transparent); color: var(--r2); border-color: transparent; }
  .type.BLOCKED { background: color-mix(in srgb, var(--r3) 20%, transparent); color: var(--r3); border-color: transparent; }
  .type.REQUEST { background: color-mix(in srgb, var(--r1) 18%, transparent); color: var(--r1); border-color: transparent; }
  .time { margin-left: auto; white-space: nowrap; }
  .time a { text-decoration: none; }
  .time a:hover { text-decoration: underline; }
  .summary { font-size: 15px; font-weight: 600; margin: 6px 0 0; }
  .details { margin-top: 8px; color: var(--text); opacity: .88; font-size: 13.5px; white-space: pre-wrap; word-wrap: break-word; }
  .details.clamp { max-height: 4.4em; overflow: hidden; -webkit-mask-image: linear-gradient(#000 55%, transparent); mask-image: linear-gradient(#000 55%, transparent); }
  .more { background: none; border: 0; padding: 4px 0 0; color: var(--muted); font: 600 12px inherit; cursor: pointer; }
  code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel2); border: 1px solid var(--line); padding: 0 4px; border-radius: 4px; }
  .trail { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .item { padding: 8px 0; border-top: 1px solid var(--line); font-size: 13px; }
  .item:first-of-type { border-top: 0; padding-top: 0; }
  .item .meta { font-size: 11.5px; }
  .empty { color: var(--muted); font-size: 13px; }
  .error { background: color-mix(in srgb, var(--r3) 15%, var(--panel)); border: 1px solid var(--r3); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 14px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stat { background: var(--panel2); border-radius: 8px; padding: 8px 10px; }
  .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--muted); font-size: 11.5px; }
</style>
</head>
<body>
<header>
  <h1>Agent channel</h1>
  <span class="sub" id="src">Refill Guard</span>
  <span class="state go" id="state">GO</span>
  <span class="live"><span class="dot" id="dot"></span><span id="updated">connecting…</span></span>
</header>
<main>
  <aside>
    <section class="panel"><h2>Who's doing what</h2><div id="roles"></div></section>
    <section class="panel"><h2>Who talks to whom</h2><svg id="map" viewBox="0 0 280 250" width="100%" role="img" aria-label="Messages between roles"></svg></section>
  </aside>
  <section>
    <div id="err"></div>
    <div class="toolbar" id="types"></div>
    <div class="toolbar"><input class="search" id="q" type="search" placeholder="Search messages (task number, file, Trail…)"></div>
    <div id="feed"></div>
  </section>
  <aside class="right">
    <section class="panel"><h2>Today</h2><div class="stats" id="stats"></div></section>
    <section class="panel"><h2>Waiting on someone</h2><div id="open"></div></section>
    <section class="panel"><h2>Decisions</h2><div id="decisions"></div></section>
  </aside>
</main>
<script>
const ROLES = {
  "ROLE-1": { name: "Role 1", job: "Voice and agent", c: "var(--r1)" },
  "ROLE-2": { name: "Role 2", job: "Platform and pharmacist", c: "var(--r2)" },
  "ROLE-3": { name: "Role 3", job: "Red team and evals", c: "var(--r3)" },
  "ROLE-4": { name: "Role 4", job: "The lock, integrator", c: "var(--r4)" },
  "HUMAN": { name: "Humans", job: "Steering", c: "var(--human)" },
  "ALL": { name: "Everyone", job: "", c: "var(--all)" },
};
const TYPES = ["CLAIM","STATUS","DECISION","OBJECT","REQUEST","REPLY","HANDOFF","BLOCKED","REVIEW","MERGED","HUMAN"];
const state = { role: null, types: new Set(), q: "", seen: new Set(), first: true, open: new Set(), data: [] };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const color = (r) => (ROLES[r] || ROLES.ALL).c;
const label = (r) => (ROLES[r] || { name: r }).name;

function inline(s) {
  return esc(s)
    .replace(/\x60([^\x60\n]+)\x60/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(https:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const trails = (m) => [...new Set([...(m.body.matchAll(/(?:[Tt]rail\s*#\s*|\/trails\/)(\d+)/g))].map((x) => x[1]))];

function filtered() {
  const q = state.q.toLowerCase();
  return state.data.filter((m) =>
    (!state.role || m.from === state.role || m.to === state.role) &&
    (!state.types.size || state.types.has(m.type)) &&
    (!q || m.body.toLowerCase().includes(q) || m.u.toLowerCase().includes(q)));
}

function renderFeed() {
  const list = filtered().slice().reverse();
  $("feed").innerHTML = list.length ? list.map((m) => {
    const fresh = !state.first && !state.seen.has(m.id);
    const long = m.details.length > 220 || m.details.split("\n").length > 3;
    const open = state.open.has(m.id);
    const tr = trails(m).map((n) => '<span class="trail">Trail #' + n + "</span>").join(" ");
    return '<article class="msg' + (fresh ? " new" : "") + '" style="--c:' + color(m.from) + ";--tc:" + color(m.to) + '">' +
      '<div class="meta"><span class="who">' + esc(label(m.from)) + '</span><span class="arrow">→</span><span class="to">' + esc(label(m.to)) + "</span>" +
      '<span class="type ' + esc(m.type) + '">' + esc(m.type) + "</span>" + tr +
      '<span class="time" title="' + esc(new Date(m.t).toLocaleString()) + '"><a href="' + esc(m.url) + '" target="_blank" rel="noopener noreferrer">' + clock(m.t) + " · " + ago(m.t) + "</a> · " + esc(m.u) + "</span></div>" +
      '<p class="summary">' + inline(m.summary) + "</p>" +
      (m.details ? '<div class="details' + (long && !open ? " clamp" : "") + '">' + inline(m.details) + "</div>" +
        (long ? '<button class="more" data-id="' + m.id + '">' + (open ? "Show less" : "Show more") + "</button>" : "") : "") +
      "</article>";
  }).join("") : '<p class="empty">No messages match.</p>';
}

function renderRoles() {
  $("roles").innerHTML = ["ROLE-1", "ROLE-2", "ROLE-3", "ROLE-4", "HUMAN"].map((r) => {
    const mine = state.data.filter((m) => m.from === r);
    const last = (t) => mine.filter((m) => t.includes(m.type)).at(-1);
    const doing = r === "HUMAN" ? last(["HUMAN"]) : last(["STATUS", "CLAIM", "HANDOFF", "MERGED", "BLOCKED"]);
    const line = doing ? "<b>" + esc(doing.type === "HUMAN" ? "" : doing.type.toLowerCase() + ": ") + "</b>" + inline(doing.summary) + " · " + ago(doing.t)
      : (mine.length ? "" : "Hasn't posted yet");
    return '<button class="role' + (state.role === r ? " on" : "") + '" data-role="' + r + '" style="--c:' + ROLES[r].c + '">' +
      '<div class="top"><span class="name">' + ROLES[r].name + ' <span class="n">' + esc(ROLES[r].job) + '</span></span><span class="n">' + mine.length + "</span></div>" +
      '<div class="doing">' + line + "</div></button>";
  }).join("");
}

function renderMap() {
  const P = { "HUMAN": [140, 26], "ROLE-1": [40, 100], "ROLE-2": [240, 100], "ROLE-3": [40, 220], "ROLE-4": [240, 220], "ALL": [140, 160] };
  const counts = {};
  for (const m of state.data) { if (!P[m.from] || !P[m.to] || m.from === m.to) continue; const k = m.from + ">" + m.to; counts[k] = (counts[k] || 0) + 1; }
  const max = Math.max(1, ...Object.values(counts));
  let edges = "", labels = "";
  for (const [k, n] of Object.entries(counts)) {
    const [a, b] = k.split(">"); const [x1, y1] = P[a], [x2, y2] = P[b];
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18, my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
    const dim = state.role && a !== state.role && b !== state.role ? " dim" : "";
    edges += '<path class="edge' + dim + '" d="M' + x1 + " " + y1 + " Q" + mx + " " + my + " " + x2 + " " + y2 + '" stroke="' + color(a) + '" stroke-width="' + (1.5 + 5 * n / max) + '" marker-end="url(#h)"><title>' + label(a) + " → " + label(b) + ": " + n + "</title></path>";
    if (!dim) labels += '<text class="cnt" x="' + (0.25 * x1 + 0.5 * mx + 0.25 * x2) + '" y="' + (0.25 * y1 + 0.5 * my + 0.25 * y2 + 3) + '" text-anchor="middle">' + n + "</text>";
  }
  const nodes = Object.entries(P).map(([r, [x, y]]) =>
    '<g><circle cx="' + x + '" cy="' + y + '" r="' + (r === "ALL" ? 15 : 19) + '" fill="var(--panel2)" stroke="' + color(r) + '" stroke-width="2.5"/>' +
    '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle">' + (r === "ALL" ? "ALL" : r === "HUMAN" ? "You" : r.slice(5)) + "</text></g>").join("");
  $("map").innerHTML = '<defs><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker></defs>' + edges + labels + nodes;
}

function renderSide() {
  const d = state.data;
  // A REQUEST is open until the role it was sent to posts a REPLY or HANDOFF back to the sender.
  const open = d.filter((m, i) => m.type === "REQUEST" && !d.slice(i + 1).some((r) => r.from === m.to && (r.to === m.from || r.to === "ALL") && (r.type === "REPLY" || r.type === "HANDOFF" || r.type === "MERGED")));
  const blocked = d.filter((m, i) => m.type === "BLOCKED" && !d.slice(i + 1).some((r) => r.type === "HUMAN" || (r.from === m.from && r.type === "STATUS" && !/block/i.test(r.summary))));
  const waiting = [...blocked, ...open].sort((a, b) => a.t < b.t ? 1 : -1);
  $("open").innerHTML = waiting.length ? waiting.map((m) =>
    '<div class="item" style="--c:' + color(m.from) + ";--tc:" + color(m.to) + '"><div class="meta"><span class="who">' + label(m.from) + '</span><span class="arrow">→</span><span class="to">' + label(m.to) + '</span><span class="type ' + m.type + '">' + m.type + '</span><span class="time">' + ago(m.t) + "</span></div>" + inline(m.summary) + "</div>").join("")
    : '<p class="empty">Nobody is waiting.</p>';
  const dec = d.filter((m) => m.type === "DECISION" || m.type === "OBJECT").reverse();
  $("decisions").innerHTML = dec.length ? dec.map((m) =>
    '<div class="item" style="--c:' + color(m.from) + '"><div class="meta"><span class="who">' + label(m.from) + '</span><span class="type ' + m.type + '">' + m.type + '</span><span class="time">' + ago(m.t) + "</span></div>" + inline(m.summary) + "</div>").join("")
    : '<p class="empty">No decisions yet.</p>';
  const today = d.filter((m) => new Date(m.t).toDateString() === new Date().toDateString());
  const n = (t) => today.filter((m) => m.type === t).length;
  $("stats").innerHTML = [["Messages", today.length], ["Handoffs", n("HANDOFF")], ["Merged", n("MERGED")], ["Decisions", n("DECISION")], ["Requests", n("REQUEST")], ["Blocked", n("BLOCKED")]]
    .map(([k, v]) => '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>").join("");
}

function renderTypes() {
  const present = new Set(state.data.map((m) => m.type));
  $("types").innerHTML = '<button class="chip' + (state.types.size ? "" : " on") + '" data-type="">All</button>' +
    TYPES.filter((t) => present.has(t)).map((t) => '<button class="chip' + (state.types.has(t) ? " on" : "") + '" data-type="' + t + '">' + t + "</button>").join("");
}

function render() { renderRoles(); renderMap(); renderTypes(); renderFeed(); renderSide(); }

async function load() {
  try {
    const r = await fetch("/api/messages", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    state.data = j.messages;
    $("src").textContent = "Refill Guard · " + j.repo + " issue #" + j.issue;
    const sg = j.messages.filter((m) => m.from === "HUMAN" && /^(STOP|GO)\b/.test(m.summary)).at(-1);
    const stopped = sg && /^STOP/.test(sg.summary);
    $("state").textContent = stopped ? "STOPPED" : "GO";
    $("state").className = "state " + (stopped ? "stop" : "go");
    $("err").innerHTML = ""; $("dot").className = "dot";
    $("updated").textContent = "live · " + j.messages.length + " messages · updated " + clock(new Date());
    render();
    state.first = false;
    j.messages.forEach((m) => state.seen.add(m.id));
  } catch (e) {
    $("dot").className = "dot err"; $("updated").textContent = "offline";
    $("err").innerHTML = '<div class="error"><b>Can\'t read the channel.</b> ' + esc(e.message) + "<br>Check <code>gh auth status</code>, then this page retries by itself.</div>";
  }
}

document.addEventListener("click", (e) => {
  const role = e.target.closest("[data-role]"), type = e.target.closest("[data-type]"), more = e.target.closest(".more");
  if (role) { state.role = state.role === role.dataset.role ? null : role.dataset.role; render(); }
  if (type) { const t = type.dataset.type; if (!t) state.types.clear(); else state.types.has(t) ? state.types.delete(t) : state.types.add(t); render(); }
  if (more) { const id = Number(more.dataset.id); state.open.has(id) ? state.open.delete(id) : state.open.add(id); renderFeed(); }
});
$("q").addEventListener("input", (e) => { state.q = e.target.value; renderFeed(); });
load();
setInterval(load, 10000);
setInterval(() => { if (!document.hidden) renderRoles(); }, 60000);
</script>
</body>
</html>`;
