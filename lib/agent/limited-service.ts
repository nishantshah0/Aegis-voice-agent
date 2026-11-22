// Inbound phone continuity when the conversation provider is unavailable.
// Identity is established only by the same lookup and one-time code as a model-led call.
import type { ButtonInputs } from "@/lib/contract";

export type LocalIdentity = { name?: string; dob?: string; rx_number?: string; lookupId?: string };
export const GREETING_ONLY = /^(?:hey(?: there)?|hi(?: there)?|hello|yo|good (?:morning|afternoon|evening))[.!?\s]*$/i;
export const PHONE_MENU = "Hi! Are you calling about a refill, a price, or an appointment?";
export const LIMITED_MENU = "The conversational service is temporarily unavailable. I can still check your fill history or insurance quote, or take a request for a pharmacist.";

export function collectIdentity(draft: LocalIdentity, line: string): ButtonInputs["lookup_patient"] | undefined {
  const rx = line.match(/\b(?:rx|sim)[ -]?\d{5,8}\b/i);
  const dob = line.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const name = line.match(/(?:^|\b(?:i['’]m|i am|my name is|this is)\s+)([\p{L}'’-]+(?: [\p{L}'’-]+){1,3})(?=,|\s+\d{4}-|$)/iu);
  if (rx) draft.rx_number = rx[0];
  if (dob) draft.dob = dob[0];
  if (name) draft.name = name[1];
  if (draft.name && draft.dob && draft.rx_number) return { name: draft.name, dob: draft.dob, rx_number: draft.rx_number };
}

export function readCode(line: string): string | undefined {
  return line.match(/^(?:(?:my |the )?code(?: is|['’]s)?\s+|it['’]s\s+)?(\d(?:[ -]?\d){5})[.!\s]*$/i)?.[1].replace(/\D/g, "");
}
