export const APPOINTMENT_CONFIRMATION_QUESTION = "Would you like me to book that appointment?";

/** A conditional answer, change of time, or unrelated reply requires clarification. */
export function confirmsBooking(text: string): boolean {
  const answer = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:yes|yeah|yep|sure|ok(?:ay)?|please do|go ahead|book (?:it|that))(?: (?:please|go ahead|book (?:it|that)|thanks|thank you))*$/.test(answer);
}
