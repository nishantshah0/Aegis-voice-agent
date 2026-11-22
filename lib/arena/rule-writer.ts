// The rule writer (SPEC Part 3, "The rule writer"; AUDIT #9, Trail #78, Role 3 stand-in).
// A pharmacist types a rule; Fable 5.2 proposes a card, a plain restatement and three
// button-level tests as structured output. Then code, not the model, decides:
//   - the lock's checkCard rejects a card that fails the schema, reads an unlisted field, or
//     has an outcome other than refuse, route or flag;
//   - the three tests run through the real rule engine, with no AI, same answer every time;
//   - the impact preview replays the card over the stored context of every past request.
// The result is a DRAFT: never live. Only applyApprovedCard (lib/control) puts a card live,
// after a signed-in pharmacist approves it.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CARD_FIELDS, type Approver, type CardCondition, type RuleCard, type RuleContext, type Store } from "@/lib/contract";
import { buildContext, CARD_BUTTONS, checkCard, evaluate, type CardButton } from "@/lib/control";
import { sharedUsageCap, type UsageCap } from "@/lib/agent/usage";
import { IDS, SEED } from "@/lib/seed";

/** CLAUDE.md: Fable 5.2 writes rules. */
export const RULE_WRITER_MODEL = "claude-fable-5-2";

export type TestKind = "should_catch" | "should_not_catch" | "edge";
const TEST_KINDS: TestKind[] = ["should_catch", "should_not_catch", "edge"];

export type ProposedTest = { kind: TestKind; description: string; button: CardButton; context: RuleContext; expectMatch: boolean };

export type Proposal = {
  card: Pick<RuleCard, "wording" | "when" | "then" | "appliesTo" | "risk"> & { flagText?: string };
  restatement: string;
  tests: ProposedTest[];
};

export type Proposer = (text: string) => Promise<Proposal>;

export type DraftTestResult = ProposedTest & { matched: boolean; passed: boolean };

export type RuleDraft = {
  id: string;
  text: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  card: RuleCard;
  restatement: string;
  tests: DraftTestResult[];
  /** The card replayed over every stored request on its first button. */
  impact: { button: CardButton; total: number; matched: number; outcome: RuleCard["then"] };
  /** Why it can't be approved yet. Empty when ready. */
  problems: string[];
  ready: boolean;
};

const KIND_LABEL: Record<TestKind, string> = { should_catch: "should catch", should_not_catch: "shouldn't catch", edge: "edge case" };

/** A normal refill's full context (Jordan's statin on the seed clock), so a test only states what differs. */
function baseContext(): RuleContext {
  const patient = SEED.patients.find((p) => p.id === IDS.p2)!;
  const rx = SEED.prescriptions.find((r) => r.id === IDS.p2Atorvastatin)!;
  return { ...buildContext({ now: SEED.now, patient, rx, record: [], policy: SEED.policy }), "call.caller_type": "patient", "call.direction": "inbound" };
}

const asLive = (card: RuleCard): RuleCard => ({ ...card, live: true });

export async function writeDraft({ id, text, author, store, propose }: { id: string; text: string; author: Approver; store: Store; propose: Proposer }): Promise<RuleDraft> {
  const proposal = await propose(text);
  const p = proposal.card;
  const card: RuleCard = {
    id,
    wording: p.wording,
    when: p.when,
    then: p.then,
    ...(p.flagText ? { flagText: p.flagText } : {}),
    appliesTo: p.appliesTo,
    risk: p.risk,
    author: `rule writer (${RULE_WRITER_MODEL}) for ${author.name}`,
    approvedBy: "",
    approvedAt: "",
    tests: proposal.tests.map((t) => `${KIND_LABEL[t.kind] ?? t.kind}: ${t.description}`),
    live: false,
  };

  const problems: string[] = [];
  const checked = checkCard(card, await store.listCards());
  if (!checked.ok) problems.push(...checked.errors);

  const base = baseContext();
  const tests: DraftTestResult[] = proposal.tests.map((t) => {
    const unknown = Object.keys(t.context).filter((k) => !(CARD_FIELDS as readonly string[]).includes(k));
    if (unknown.length) problems.push(`Test "${t.description}" sets fields cards can't read: ${unknown.join(", ")}`);
    const matched = checked.ok && evaluate([asLive(card)], t.button, { ...base, ...t.context }).matched.length > 0;
    const passed = checked.ok && unknown.length === 0 && matched === t.expectMatch;
    if (checked.ok && !passed && unknown.length === 0) {
      problems.push(`Test "${t.description}" (${KIND_LABEL[t.kind] ?? t.kind}) expected the card ${t.expectMatch ? "to catch it" : "not to catch it"}, but it ${matched ? "did" : "didn't"}`);
    }
    return { ...t, matched, passed };
  });
  for (const kind of TEST_KINDS) if (!tests.some((t) => t.kind === kind)) problems.push(`Missing a "${KIND_LABEL[kind]}" test`);

  const button: CardButton = p.appliesTo?.includes("request_refill") ? "request_refill" : ((p.appliesTo?.[0] as CardButton) ?? "request_refill");
  const past = (await store.listRecord()).filter((e) => e.kind === "button" && e.button === button && e.context);
  const matched = checked.ok ? past.filter((e) => evaluate([asLive(card)], button, e.context!).matched.length > 0).length : 0;

  return {
    id,
    text,
    createdAt: await store.now(),
    createdBy: { id: author.id, name: author.name },
    card,
    restatement: proposal.restatement,
    tests,
    impact: { button, total: past.length, matched, outcome: card.then },
    problems,
    ready: problems.length === 0,
  };
}

// ---------- the model ----------

const FIELD_HELP: Record<(typeof CARD_FIELDS)[number], string> = {
  "drug.class": 'text, e.g. "statin", "stimulant", "SSRI", "antibiotic"',
  "drug.controlled": "true or false",
  "rx.pct_days_elapsed": "number, percent of the days supplied that have passed since the last fill",
  "rx.days_late": "number, days past the end of the supply (0 if not late)",
  "rx.refills_left": "number",
  "rx.expired": "true or false",
  "rx.days_since_last_fill": "number",
  "rx.prescribed_interval_days": "number",
  "call.direction": '"inbound" or "outbound"',
  "call.caller_type": '"patient" (verified) or "unverified"',
  "call.local_hour": "number 0 to 23, pharmacy time",
  "patient.flags": "list of text flags on the patient (use the contains operator)",
  "patient.opted_in": "true or false (outbound calls)",
  "request.reason_given": "true or false",
  "recent.blocked_count_10min": "number",
  "recent.renewals_7d": "number",
  "recent.outbound_calls_3d": "number",
  "policy.controlled_early_window_days": "number",
};

const ProposalSchema = z.object({
  wording: z.string(),
  restatement: z.string(),
  risk: z.string(),
  then: z.enum(["refuse", "route", "flag"]),
  flag_text: z.string().nullable(),
  applies_to: z.array(z.enum(CARD_BUTTONS)),
  conditions: z.array(z.object({ field: z.enum(CARD_FIELDS), op: z.enum(["=", "!=", "<", "<=", ">", ">=", "in", "contains"]), value_json: z.string() })),
  tests: z.array(
    z.object({
      kind: z.enum(["should_catch", "should_not_catch", "edge"]),
      description: z.string(),
      button: z.enum(CARD_BUTTONS),
      context_json: z.string(),
      expect_match: z.boolean(),
    }),
  ),
});

const SYSTEM = `You turn a pharmacist's plain-English rule into one rule card for a pharmacy phone line's safety layer. You only propose; code checks your card and a pharmacist approves it.

A card has conditions that must ALL hold, and one outcome:
- "refuse": the request is refused.
- "route": a pharmacist must approve it.
- "flag": it goes through, with a note to the pharmacist.
There is no "allow". A card can only make things stricter.

Buttons a card can apply to: request_refill, request_renewal, set_delivery, outbound_check (whether the line may phone the patient).

Fields a condition may read, and their values:
${Object.entries(FIELD_HELP)
  .map(([f, h]) => `- ${f}: ${h}`)
  .join("\n")}

Operators: = != < <= > >= in contains. value_json is the value as JSON: "antibiotic" (with quotes), 80, true, or ["a","b"] for "in". To compare with another field, give {"field": "rx.prescribed_interval_days", "minus": 3}.

Write:
- wording: the rule as one short sentence.
- restatement: what the card will do, in plain words a pharmacist can check, e.g. "Every refill of a drug in the antibiotic class will wait for a pharmacist."
- risk: the harm it prevents, a few words.
- exactly three tests, one of each kind: should_catch, should_not_catch, edge. Each has the button pressed, context_json (a JSON object of only the fields that matter, e.g. {"drug.class": "antibiotic"}), and expect_match (true if the card should match).
Use flag_text only for "flag" cards, otherwise null.`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Fable 5.2 with structured output. Throws on a refusal or a reply that doesn't parse. */
export function claudeProposer(client = new Anthropic()): Proposer {
  return async (text) => {
    const response = await client.beta.messages.create({
      model: RULE_WRITER_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(ProposalSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    if (response.stop_reason === "refusal") throw new Error("the model declined to write this rule");
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("the model returned no card");
    return toProposal(JSON.parse(block.text));
  };
}

/** The model's structured output, checked against the schema, as a Proposal. */
function toProposal(raw: unknown): Proposal {
  const out = ProposalSchema.parse(raw);
  const when = out.conditions.map((c) => ({ field: c.field, op: c.op, value: parseJson(c.value_json) }) as CardCondition);
  return {
    card: { wording: out.wording, when, then: out.then, appliesTo: out.applies_to, risk: out.risk, ...(out.flag_text ? { flagText: out.flag_text } : {}) },
    restatement: out.restatement,
    tests: out.tests.map((t) => {
      const ctx = parseJson(t.context_json);
      return { kind: t.kind, description: t.description, button: t.button, context: ctx && typeof ctx === "object" && !Array.isArray(ctx) ? (ctx as RuleContext) : {}, expectMatch: t.expect_match };
    }),
  };
}

/**
 * The same model and schema on the Claude Agent SDK, for machines with no API key that run
 * live models on their Claude plan (LIVE_AGENT=1), like the attacker: no tools, one answer,
 * under the shared hourly cap, logged to the usage log.
 */
/** The schema as plain JSON Schema; the Agent SDK's CLI doesn't accept a $schema dialect key. */
const SDK_SCHEMA = (() => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(ProposalSchema) as Record<string, unknown>;
  void _dialect;
  return schema;
})();

export function sdkProposer({ model = RULE_WRITER_MODEL, cap = sharedUsageCap() }: { model?: string; cap?: UsageCap } = {}): Proposer {
  return async (text) => {
    if (process.env.LIVE_AGENT !== "1") throw new Error("Live model calls are off. Set LIVE_AGENT=1 or ANTHROPIC_API_KEY.");
    cap.check();
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const query = sdk.query({
      prompt: text,
      options: {
        systemPrompt: SYSTEM,
        model,
        effort: "low",
        outputFormat: { type: "json_schema", schema: SDK_SCHEMA },
        tools: [],
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        plugins: [],
        skills: [],
        settingSources: [],
        permissionMode: "dontAsk",
        persistSession: false,
        maxTurns: 3,
      } as never,
    });
    let structured: unknown;
    let entry: Parameters<UsageCap["record"]>[0] = { callId: "rule_writer", model, modelCalls: 1 };
    for await (const message of query as AsyncIterable<Record<string, unknown>>) {
      if (message.type !== "result") continue;
      structured = message.structured_output;
      entry = { ...entry, usage: message.usage, ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}), ...(typeof message.subtype === "string" ? { subtype: message.subtype } : {}) };
    }
    cap.record(entry);
    if (!structured) throw new Error("the model returned no card");
    return toProposal(structured);
  };
}
