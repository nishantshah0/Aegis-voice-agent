// Selection works only against slots actually returned to this verified call.
// All remaining date/time words must be understood before an offer is selected.
import type { AppointmentOffer } from "@/lib/contract/buttons";

const subject = /\b(?:appointments?|consultations?|meeting|meet (?:with )?(?:a |the |my )?pharmacist)\b/i;
const weekdays = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
const clockWords: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};
const nameNumber = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g;
const timeWords = /\b(?:morning|afternoon|evening|at|today|tomorrow|instead|earlier|later|noon|midnight|time|first|second)\b|\d/i;
const unrelated = /\b(?:refill|copay|delivery|dose|insurance|symptoms?|side effects?|medical advice)\b/i;
const negative = /\b(?:no thanks|no thank you|never mind|nevermind|forget (?:it|that)|don't book|do not book)\b/i;

export type CalendarIntent = "list" | "status" | "manage" | "decline" | "other-person";

export function calendarIntent(text: string, choosing: boolean): CalendarIntent | undefined {
  const named = subject.test(text);
  if (unrelated.test(text)) return;
  if (!named && !choosing && !/\bbook\b.*\b(?:mon|tue|wed|thu|fri|sat|sun)/i.test(text)) return;
  if (negative.test(text) || choosing && /^no[.! ]*$/i.test(text.trim())) return "decline";
  if (/\b(?:wife|husband|mother|father|brother|sister|spouse|daughter|son|friend)\b/i.test(text)) return "other-person";
  if (named && /\b(?:move|reschedule|cancel)\b/i.test(text)) return "manage";
  if (named && /\b(?:when is my|what time is my|what day is my|already booked|do i (?:already )?have|my (?:existing|scheduled|booked)|check my|list my)\b/i.test(text)) return "status";
  if (named || /\bbook\b/i.test(text) || choosing && (timeWords.test(text) || text.match(weekdays) || /\b(?:slot|one|works|yes)\b/i.test(text))) return "list";
}

function clock(text: string) {
  return text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
}

// A requested weekday and a requested hour constrain the very same slot. The
// slot labels are spoken to the caller verbatim even when no selector matches.
export function chooseCalendarOffer(text: string, slots: AppointmentOffer[]): AppointmentOffer | undefined {
  let rest = text.toLowerCase().replace(/[’']/g, "").replace(/a\.m\.?/g, "am").replace(/p\.m\.?/g, "pm");
  // Only an explicit correction with a fresh time can replace a pending offer.
  if (/\b(?:not|dont|cannot|cant|except|before|after|maybe|if|or|next|tomorrow|today|month|week|probably|rather than)\b/.test(rest)) return;
  const days = [...rest.matchAll(weekdays)].map(m => m[1].slice(0, 3));
  if (days.length > 1) return;
  rest = rest.replace(weekdays, " ").replace(/\b(?:the|that) one\b|\bone (?=works|appointment|please|instead)|\bone\s*[.!?]?$/g, " ");
  const period = /\b(morning|afternoon|evening)\b/.exec(rest)?.[1];
  rest = rest.replace(/\b(?:morning|afternoon|evening)\b/g, " ");
  rest = rest.replace(nameNumber, w => clockWords[w]);
  const time = clock(rest);
  if (time) rest = rest.replace(time[0], " ");
  // An unsupported constraint, including a second time, time zone or date, means ask again.
  const filler = /\b(?:a|actually|an|and|appointment|appointments|are|at|be|book|can|consultation|could|does|eastern|for|have|i|id|ill|instead|is|it|like|make|me|meet|meeting|my|of|on|one|please|pharmacist|reserve|schedule|slot|that|the|this|time|to|want|will|with|work|works|would|yes|you)\b/g;
  if (rest.replace(filler, " ").replace(/[.,?!\s-]/g, "")) return;
  if (!days.length && !time && !period) return;
  const matches = slots.filter(slot => {
    const label = slot.slot_label.toLowerCase();
    if (days.length && !label.startsWith(days[0])) return false;
    if (!time && !period) return true;
    const actual = clock(label.split(" at ")[1] ?? "");
    if (!actual) return false;
    if (time && (Number(time[1]) !== Number(actual[1]) || Number(time[2] ?? 0) !== Number(actual[2] ?? 0)
      || time[3] && time[3] !== actual[3])) return false;
    const hour24 = Number(actual[1]) % 12 + (actual[3] === "pm" ? 12 : 0);
    if (period === "morning") return hour24 < 12;
    if (period === "afternoon") return hour24 >= 12 && hour24 < 17;
    if (period === "evening") return hour24 >= 17;
    return true;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
