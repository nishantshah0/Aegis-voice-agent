// The lines the agent says word for word (SPEC Part 2, "The call, inbound" and
// "The call, outbound"). They are scripted so the wording cannot drift between
// calls, and so the privacy-sensitive ones are impossible to paraphrase.
//
// These are the words we intend to say, not permission to skip the guard. Every
// one of them still goes through `guardSentence` before it reaches speech, and
// the ones that report an action are spoken only after that button has returned.

/**
 * SPEC Part 2, inbound step 1. Tier 0 questions are answered straight after this,
 * with no verification.
 */
export function inboundGreeting(pharmacyName: string): string {
  return `Hi, this is the automated assistant for ${pharmacyName}. What can I help with?`;
}

/**
 * SPEC Part 2, inbound step 2. Asked once the caller wants anything above tier 0.
 */
export const ASK_TO_VERIFY =
  "Before we go further, can I take your name, your date of birth, and the prescription number on the bottle?";

/**
 * SPEC Part 2, inbound step 3. Said with **the same words whether or not the
 * details match**, so the line itself never reveals whether the patient exists.
 * That is why this is a constant and not a template.
 *
 * Spoken only after `send_code` returns, so S4 ("sent" only after that button
 * succeeded) holds.
 */
export const CODE_SENT = "If those details match, I've sent a code to the phone on file.";

/** Said while a button is in flight, so the caller is not left in silence. */
export const HOLDING = "One moment.";

/**
 * SPEC Part 2, outbound step 2, and the **one exception to S1**: before
 * verification this line may carry the patient's name and the pharmacy's name,
 * and nothing else. Nothing about the reason for the call, the drug or the
 * prescription may appear here.
 *
 * Takes the name as a single already-chosen string so no record field can leak
 * in by accident.
 */
export function outboundOpener(pharmacyName: string, patientName: string): string {
  return `This is ${pharmacyName} calling for ${patientName}. To continue, I'll send a code to this phone.`;
}

/**
 * SPEC Part 2, outbound step 2, when someone other than the patient answers.
 * Says nothing about why we called, and doesn't name the patient again: only the
 * opener may say the name (S1's one exception), so a second mention is replaced.
 */
export function outboundWrongPerson(pharmacyName: string): string {
  return `No problem. Could you ask them to call ${pharmacyName} back when they have a moment?`;
}

/**
 * SPEC Part 2, inbound step 7. The drug name is deliberately absent: it is said
 * only after the caller says yes, in case someone else is listening. Not "ready":
 * S4 hears that as a promise the record doesn't back yet.
 */
export const REFILL_SYNC_OFFER = "You have one other prescription that can be refilled today. Want me to add it?";

/**
 * SPEC Part 2, inbound step 8, the mild side-effect path. Spoken only after
 * `note_for_pharmacist` returns, so S4 holds. Carries no advice and no callback
 * time, because S4 blocks a time that is not a booked slot.
 */
export const SIDE_EFFECT_PASSED_ON = "Thanks, I've passed that to the pharmacist with your refill.";

/**
 * SPEC Part 2, inbound step 9. Said when rule 6 (missed doses) flagged the refill.
 * "May call" is deliberate: a definite callback would be a promise S4 blocks.
 */
export const MISSED_DOSES_CHECK_IN = "A pharmacist may call you to check in.";

/**
 * The side effects a label actually lists, exactly as printed, or `null` when the
 * label does not list any.
 *
 * SPEC Part 2, inbound step 8 requires the side-effect question to name the common
 * side effects "listed on that drug's label text, quoted, never from memory". So
 * this only ever returns text taken from `labelText`. It never falls back to what a
 * model might know about a drug.
 */
export function labelSideEffects(labelText: string): string | null {
  const match =
    /side[- ]effects?(?:\s+may\s+include|\s+include|\s+can\s+include)?\s*[:,-]\s*([^.]+)/i.exec(labelText) ??
    /may\s+cause\s*[:,-]?\s*([^.]+)/i.exec(labelText);
  if (!match) return null;
  const listed = match[1].trim().replace(/\s+/g, " ");
  return listed.length > 0 ? listed : null;
}

/**
 * SPEC Part 2, inbound step 8: one structured question, asked after any refill.
 *
 * When the label lists side effects, they are quoted into the question. When it
 * does not, the question asks the same thing without naming any, because naming
 * side effects the label does not list would mean inventing clinical detail.
 *
 * The seeded labels hold directions only, so today this takes the second form.
 * See the REQUEST to Role 4 about label side-effect text.
 */
export function sideEffectQuestion(labelText: string): string {
  const listed = labelSideEffects(labelText);
  return listed === null
    ? "Since your last refill, have you noticed any side effects, or anything else?"
    : `Since your last refill, any side effects, like ${listed}, or anything else?`;
}
