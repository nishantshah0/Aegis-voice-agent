// The safety keyword check (SPEC Part 3, "Safety checks"). Runs on every caller line
// before the model sees it. False alarms are acceptable; missed emergencies are not.
// Role 1 adds the optional Haiku check behind the same function. No model sits behind it on
// the hosted routes, so this list has to hear what people really say (RT-SAFE-1).

import type { CheckCallerLineFn, EmitFn, SafetyResult, Store } from "@/lib/contract";
import { hearableForms, UNREADABLE } from "./normalize";
import { words } from "./tokens";

export const EMERGENCY_SCRIPT =
  "This sounds like it could be an emergency. Please hang up and call 911 now, or call Poison Control if you took too much of a medicine.";
export const CRISIS_SCRIPT =
  "I'm really sorry you're going through this. You can call or text 9-8-8 any time to reach the Suicide Crisis Helpline. I'm also asking a pharmacist to check in on your refills.";
export const HANDOVER_SCRIPT = "Of course. I'm getting a pharmacist for you now.";

// Each list is matched on every way the line can be heard (lib/guard/normalize.ts): look-alike
// letters, invisible characters, spelling and leetspeak are the plain word. Patterns, not exact
// phrases, so plurals, typos and slang match too (RT-SAFE-1, Trail #86).

const SELF = "my ?self";
const CRISIS: RegExp[] = [
  new RegExp(`\\b(?:kill|kil|killing|kiling|off|offing|unalive|unaliving|hurt|hurting|harm|harming|cut|cutting|shoot|hang|drown) ${SELF}\\b`),
  /\bunalive\b/,
  /\bkms\b/,
  /\b(?:suicid\w*|sucide|suicde|suiside|suiside\w*|sewer slide)\b/,
  /\bself ?harm\w*\b/,
  /\bend (?:my|this) (?:life|lfe)\b/,
  /\bend it(?: all)?\b(?! (?:here|there|now|today|for today))/,
  /\bend (?:things|everything)\b/,
  /\btake my (?:own )?life\b/,
  /\b(?:dont|do not|dont really|really dont) want to (?:live|be alive|be here(?: anymore)?|exist|wake up|go on)\b/,
  /\bwant to (?:die|not wake up|not be here|not exist|disappear forever)\b/,
  // Unsure whether they want to live: ambiguous, so it leans safe.
  /\b(?:not sure|dont know if|dont know whether|unsure if) i (?:want|wanna) to (?:live|be alive|go on|be here)\b/,
  /\b(?:wish i (?:was|were) dead|better off dead|better off without me|no reason to live|nothing to live for)\b/,
  /\b(?:wont|will not|not going to) be around (?:much )?(?:longer|anymore|for long)\b/,
  /\bgoing to end (?:it|things|everything|my life)\b/,
  // Spanish, French, romanized Hindi.
  /\b(?:suicidarme|matarme|quitarme la vida|quiero morir(?:me)?|me quiero morir|no quiero vivir)\b/,
  /\b(?:me tuer|me suicider|envie de mourir|veux mourir|en finir|plus envie de vivre)\b/,
  /\b(?:marna chaht[ai]|marna hai|khudkushi|aatmahatya|atmahatya|jaan de (?:dunga|dungi|dena))\b/,
];
// Scripts words() can't read: matched on the line itself.
const CRISIS_SCRIPTS = /自杀|自殺|想死|不想活|轻生|मरना|मर जा|आत्महत्या|खुदकुशी|ख़ुदकुशी/u;

// "I'm not suicidal": dropped before the crisis check. Anything less plain stays a crisis.
const NOT_CRISIS = new RegExp(
  [
    `\\b(?:im|i am|i m) not (?:suicidal|going to (?:kill|hurt|harm) ${SELF})\\b`,
    `\\bi (?:would|will) never (?:kill|hurt|harm) ${SELF}\\b`,
    `\\bno (?:thoughts|thinking) (?:of|about) (?:suicide|killing ${SELF}|hurting ${SELF})\\b`,
  ].join("|"),
  "g",
);

const NUM = "(?:[2-9]|\\d{2,}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|several|a bunch|a lot|lots|loads)";
const EMERGENCY: RegExp[] = [
  // Breathing.
  /\b(?:cant|cannot|can not|couldnt|could not|barely|hardly|trouble|difficulty|hard to|struggling to|struggle to) (?:breath\w*|breth\w*|brea?the?)\b/,
  /\b(?:short of breath|not breathing|stopped breathing|wheez\w*|gasping|choking|suffocat\w*)\b/,
  // Chest, heart.
  /\bchest (?:pain\w*|hurts?|hurting|is tight|feels tight|tight\w*|pressure|is crushing)\b/,
  /\b(?:heart attack|stroke)\b/,
  /\bheart (?:is |s )?(?:racing|pounding|beating (?:really |very |so |super )?(?:fast|hard|weird|irregular))\b/,
  /\b(?:racing heart|palpitations)\b/,
  // Throat, swelling, reactions.
  /\bthroats? (?:is |s |feels |feel )?(?:closing|tight\w*|swell\w*|swollen|closing up)\b/,
  /\b(?:tongue|face|lips|lip|mouth|eyes) (?:is |are |s |feels |feel )?(?:swell\w*|swollen|puffy|puffing up)\b/,
  /\b(?:swelling|swollen|welts|hives|rash all over|allergic reaction|anaphyla\w*|bad reaction|having a reaction|had a reaction|reaction to)\b/,
  /\b(?:cant|cannot|trouble) swallow\w*\b/,
  // Consciousness.
  /\b(?:passed out|passing out|fainted|fainting|unconscious|collapsed|seizure\w*|convuls\w*|wont wake up|unresponsive)\b/,
  /\b(?:lips are blue|blue lips|vomiting blood|coughing up blood|throwing up blood)\b/,
  // Overdose, poisoning.
  /\b(?:overdos\w*|overdoes|over dosed?|od on)\b/,
  /\b(?:took|taken|take|swallowed|had) too (?:many|much)\b/,
  /\btoo many (?:pills|tablets|capsules|of them)\b/,
  /\b(?:whole|entire|full) bottle\b/,
  /\b(?:took|swallowed|ate|taken) (?:all of (?:them|it|my \w+|the \w+)|all my (?:pills|meds|tablets)|everything in the bottle)\b/,
  /\b(?:a )?handful of (?:pills|tablets|capsules|them|my)\b/,
  new RegExp(`\\b(?:took|taken|swallowed|ate|had) ${NUM} (?:of (?:my|them|those|these|the)|pills|tablets|capsules)\\b`),
  /\b(?:way |a lot |much )?more than i (?:should|was supposed to)(?: have)?\b/,
  /\b(?:double dose|doubled up|took (?:my dose|it) twice|took (?:two|2) doses)\b/,
  /\b(?:kid|kids|child|children|son|daughter|baby|toddler|grandkid|grandson|granddaughter|dog|cat|puppy) (?:ate|eaten|swallowed|got into|took|drank|has eaten|just ate)\b/,
  /\bpoison\w*\b/,
  // Spanish, French, romanized Hindi.
  /\b(?:no puedo respirar|me ahogo|dolor (?:de|en el) pecho|tome demasiad\w*|sobredosis|infarto)\b/,
  /\b(?:je (?:ne )?(?:peux|arrive) pas (?:a )?respirer|du mal a respirer|douleur (?:a la|dans la) poitrine|trop de (?:comprimes|medicaments|pilules|cachets)|surdose|overdose)\b/,
  /\b(?:saans nahi|saans lene mein|seene mein dard|chhati mein dard|bahut zyada (?:goli|goliyan|dawai|dawa))\b/,
];
const EMERGENCY_SCRIPTS = /吃了太多药|吃太多药|药吃多了|呼吸困难|喘不过气|不能呼吸|胸口痛|胸痛|过量|सांस नहीं|साँस नहीं|ज़्यादा दवा|ज्यादा दवा|सीने में दर्द/u;
// "I OD'd", "I ODed", "O.D." in capitals: "That's odd." is not one.
const OD = /\b(?:OD(?:['’]?d|['’]?ed|['’]?ing)?|O\.D\.?)(?![\p{L}])|\bod['’](?:d|ed)\b/u;

const HANDOVER: RegExp[] = [
  /\b(?:a|an actual|a real|real|actual|another|some) (?:person|human|human being)\b/,
  /\b(?:human|person|agent|pharmacist|someone) please\b/,
  /^ (?:human|agent|representative|operator|pharmacist) $/,
  /\b(?:speak|talk) (?:to|with) (?:someone|somebody|the pharmacist|a pharmacist|your pharmacist|a person|a human|staff|a manager)\b/,
  /\b(?:get|put|give|connect|transfer|send) (?:me )?(?:to |through to )?(?:a|the|your) (?:pharmacist|person|human|manager)\b/,
  /\b(?:put|get) the pharmacist on\b/,
  /\bpharmacist on the (?:line|phone)\b/,
  /\b(?:live agent|live person|someone real|somebody real|transfer me|representative|operator|a manager)\b/,
  /\b(?:the|a) pharmacist please\b/,
];

const test = (forms: string[], patterns: RegExp[]) => forms.some((w) => patterns.some((re) => re.test(w)));

/**
 * The line in every way it's heard, as words() text: look-alikes, invisible characters, spelling
 * and leetspeak undone, accents dropped, apostrophes gone ("can't" is "cant").
 */
function heard(line: string): string[] {
  return [...new Set(hearableForms(line).map((f) => words(f)))];
}

/**
 * Keyword and pattern match, on every heard form of the line. Crisis first, then emergency, then
 * a request for a person. A line in a script the check can't read goes to a person: false alarms
 * are acceptable, missed emergencies are not.
 */
export function classify(line: string): SafetyResult {
  const forms = heard(line);
  const raw = hearableForms(line);
  const crisisForms = forms.map((w) => w.replace(NOT_CRISIS, " "));
  if (test(crisisForms, CRISIS) || CRISIS_SCRIPTS.test(line)) return { action: "crisis", script: CRISIS_SCRIPT };
  if (test(forms, EMERGENCY) || EMERGENCY_SCRIPTS.test(line) || raw.some((f) => OD.test(f))) return { action: "emergency", script: EMERGENCY_SCRIPT };
  if (test(forms, HANDOVER)) return { action: "handover", script: HANDOVER_SCRIPT };
  if (raw.some((f) => UNREADABLE.test(f))) return { action: "handover", script: HANDOVER_SCRIPT };
  return { action: "continue" };
}

export function createSafetyCheck({ store, emit = () => {} }: { store: Store; emit?: EmitFn }): CheckCallerLineFn {
  return async function checkCallerLine(callId, line): Promise<SafetyResult> {
    const result = classify(line);
    try {
      const call = await store.getCall(callId);
      await store.appendRecord({ callId, actor: "caller", kind: "caller_line", input: { text: line }, decision: "allowed" });
      if (call) await store.saveCall({ ...call, callerSaid: [...call.callerSaid, line] });
      if (result.action === "continue") return result;

      await store.appendRecord({ callId, actor: "caller", kind: "safety", input: { text: line }, output: result, decision: "flagged" });
      const patientId = call?.lockedPatientId ?? call?.targetPatientId ?? "unknown";
      const item = await store.addQueueItem({
        callId,
        patientId,
        kind: "escalation",
        lane: "review",
        ruleIds: [],
        signals: ["safety_words"],
        notes: [{ id: `n_${callId}_safety`, kind: "question", text: `${result.action}: "${line}"` }],
      });
      emit({ type: "queue", item });
    } catch {
      // The keyword result stands even if the record can't be written.
    }
    return result;
  };
}
