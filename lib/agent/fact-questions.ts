// Resolve simple read-only questions without relying on a model to remember figures.
// Unknown wording and mixed action requests stay in the normal conversation.
import { canonical } from "@/lib/guard/doses";

type PrescriptionRef = { rx_id: string; drug: string };
type FactRequest = { history: boolean; coverage: boolean; days?: number };
export type FactReply = { line: string; rxId?: undefined } | (FactRequest & { rxId: string; line?: undefined });
type FactContext = {
  prescriptions: PrescriptionRef[];
  previous?: FactRequest & { rxId?: string };
};

export const newFactContext = (): FactContext => ({ prescriptions: [] });

const historyTerms = /\b(?:last (?:time|refill|fill|filled|got|get|receive|received|picked)|(?:refill|fill|prescription) history|previous (?:fill|refill)|dispensed|how many (?:pills|tablets|capsules|refills)|refills (?:are )?(?:remaining|left)|how long was (?:the|my) supply)\b/;
const costTerms = /\b(?:costs?|price|co[- ]?pay|insurance|quote|my share|pay|paid|owe|how much for|how much is|how much would|covered|coverage)\b/;
const otherPerson = /\b(?:wife|husband|spouse|partner|friend|brother|sister|mother|father|mom|dad|someone else|somebody else|roommate|son|daughter|his|their|her)\b/;
// "How much did I pay" is a copay question (1.x, Trail #75): coverage_readback states the plan's split, never a past charge.
const billing = /\b(?:balance|bill(?:ing)?|invoice|deductible|payment history|spent|charged)\b/;
const otherTask = /\b(?:refill (?:my|the|this|it)|(?:order|send|renew|book|schedule|switch|deliver|take|call|change|approve|prescribe|cancel)|appointment|side effects?|dose|pickup|delivery)\b/;

// Accept conversational filler while ensuring a reference to a different medication,
// a new action, or an unfamiliar topic cannot silently resolve to the sole prescription.
const factVocabulary = new Set(`a about actually ago all am amount an and any are as at back be bottle by can capsules case check
code co copay cost costs could cover coverage covered covers date days day did dispense dispensed do
does drug earlier exactly fill filled first for from get gets getting got had has have hey hi paid
mean meant month months wait
history how i id if in insurance insurer into is it its just know last left long many make me
medication medicine much my named no of on one only or other out pay paying pays per picked pickup
pills plan please prescription previous price prior pill tablet capsule quantity quote read receive
received record refill refills remaining remind right said same share so sorry supply tablets tell
than that the then there this time to total two up was week weeks weekly what whats when which will
with would yeah yes you your`.split(/\s+/));

// A correction cue: what follows the last one replaces what came before ("two weeks, sorry, one week").
const correction = /\b(?:sorry|no|i mean|i meant|actually|wait|make (?:it|that))\b/g;

function duration(text: string): number | "unclear" | undefined {
  if (!/\b(?:days?|weeks?|weekly|months?)\b/.test(text)) return;
  const cues = [...text.matchAll(correction)];
  if (cues.length) {
    const last = cues.at(-1)!;
    const after = text.slice(last.index + last[0].length);
    // Only when the corrected part carries a length of its own; otherwise read the whole line.
    if (/\b(?:days?|weeks?|weekly)\b/.test(after)) return lengthOf(after);
  }
  return lengthOf(text);
}

function lengthOf(text: string): number | "unclear" | undefined {
  // "A month" isn't a whole number of days we can quote: ask.
  if (/\bmonths?\b/.test(text)) return "unclear";
  if (!/\b(?:days?|weeks?|weekly)\b/.test(text)) return;
  if (/\d\.\d|(?:^|\s)-\s*\d|\b(?:minus|negative|half|every|ago|last week|per day|twice)\b/.test(text)) return "unclear";
  const numbers = canonical(text);
  const sizes = [...numbers.matchAll(/\b(\d+|a|an) (day|week)\b/g)].map(([, n, unit]) =>
    (n === "a" || n === "an" ? 1 : Number(n)) * (unit === "week" ? 7 : 1));
  if (!sizes.length && /\bweekly\b/.test(text)) sizes.push(7);
  return sizes.length === 1 && Number.isSafeInteger(sizes[0]) && sizes[0] > 0 ? sizes[0] : "unclear";
}

export function factQuestion(state: FactContext, callerText: string, outboundRx?: string): FactReply | undefined {
  const prior = state.previous;
  state.previous = undefined;
  const text = callerText.toLowerCase().replace(/[’']/g, "");
  if (otherTask.test(text)) return;
  const names = state.prescriptions.filter(rx => text.includes(rx.drug.toLowerCase()));
  const history = historyTerms.test(text);
  const coverage = costTerms.test(text);
  const corrects = !!prior && /\b(?:actually|instead|sorry|other one|no|i meant|make that)\b/.test(text);
  const choosing = !!prior && (corrects || names.length > 0 || prior.coverage && /\b(?:days?|weeks?)\b/.test(text));
  if (!history && !coverage && !choosing && !billing.test(text)) return;

  if (otherPerson.test(text)) return { line: "I can only discuss your own prescriptions." };
  if (billing.test(text)) return { line: "I don't have a billing balance or a payment history on this line." };
  const days = duration(text);
  if ((coverage || prior?.coverage) && days === "unclear") {
    state.previous = { history, coverage: true, rxId: names.length === 1 ? names[0].rx_id : prior?.rxId };
    return { line: "How many whole days of medication should I check the price for?" };
  }
  let remainder = text.replace(/co-pay/g, "copay");
  for (const rx of names) remainder = remainder.replaceAll(rx.drug.toLowerCase(), " ");
  const unknownWords = canonical(remainder).trim().split(/[^a-z0-9]+/).filter(w => w && !/^\d+$/.test(w) && !factVocabulary.has(w));
  if (unknownWords.length) return;

  const query: FactRequest = {
    history: history || !coverage && choosing && !!prior?.history,
    coverage: coverage || !history && choosing && !!prior?.coverage,
    days: days === "unclear" ? undefined : days ?? (choosing ? prior?.days : undefined),
  };
  let target = names;
  if (!target.length && /\bother one\b/.test(text) && prior?.rxId) target = state.prescriptions.filter(rx => rx.rx_id !== prior.rxId);
  else if (!target.length) {
    const defaultId = prior?.rxId ?? outboundRx;
    target = defaultId ? state.prescriptions.filter(rx => rx.rx_id === defaultId) : state.prescriptions;
  }
  if (target.length !== 1) {
    state.previous = query;
    return { line: "Which prescription would you like me to check?" };
  }
  state.previous = { ...query, rxId: target[0].rx_id };
  return { ...query, rxId: target[0].rx_id };
}
