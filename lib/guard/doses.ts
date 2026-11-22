// S3: doses, frequencies and quantities. Each one the agent says must appear in the
// locked patient's label or prescription record.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(TENS), "hundred"].join("|")})`;
/** A run of number words ("forty-one", "two hundred and fifty"), for prices said in words. */
export const NUMBER_RUN_SOURCE = `${NUMBER_WORD}(?:(?:[ -]| and )${NUMBER_WORD})*`;
const NUMBER_RUN = new RegExp(`\\b${NUMBER_WORD}(?:[ -]${NUMBER_WORD})*\\b`, "g");

/** "thirty six" → "36", "two hundred and fifty" → "250", "seven" → "7". */
export function wordsToNumber(run: string): number | undefined {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of run.split(/[ -]+/)) {
    if (w === "and") continue;
    if (w in UNITS) current += UNITS[w];
    else if (w in TENS) current += TENS[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else return undefined;
    seen = true;
  }
  total += current;
  return seen ? total : undefined;
}

const UNIT_WORDS: [RegExp, string][] = [
  [/\bmilligram[sz]?\b/g, "mg"],
  [/\bmicrogram[sz]?\b/g, "mcg"],
  // Unit slang and spelling: "72mgs", "72 m g", "seventy two m.g.", "50 mcgs".
  [/\bm\.? ?g\b\.?/g, "mg"],
  [/\b(\d*)(mg|mcg|ml)s\b/g, "$1$2"],
  [/\btabs?\b/g, "tablet"],
  [/\bcaps\b/g, "capsule"],
  [/\bmillilit(?:re|er)s?\b/g, "ml"],
  [/\bgrams?\b/g, "g"],
  [/\b(tablet|capsule|pill|dose|puff|hour|day|week|night)s\b/g, "$1"],
  [/\b(?:daily|per day|each day|a day)\b/g, "a day"],
];

/** A canonical form so "two tablets", "2 tablets" and "2 tablet" compare equal. */
export function canonical(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
  for (const [re, to] of UNIT_WORDS) t = t.replace(re, to);
  t = t.replace(NUMBER_RUN, (run) => {
    const n = wordsToNumber(run.trim());
    return n === undefined ? run : ` ${n} `;
  });
  t = t.replace(/(\d)\s+(mg|mcg|ml|g)\b/g, "$1$2");
  return t.replace(/\s+/g, " ");
}

const PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?(?:mg|mcg|ml|g)\b/g,
  /\b(?:once|twice|three times|four times|\d+ times) a (?:day|week|night)\b/g,
  /\b(?:once|twice) a day\b/g,
  /\bevery (?:\d+ )?(?:hour|day|week|morning|night|evening)\b/g,
  /\b(?:\d+|half(?: a)?) (?:tablet|capsule|pill|dose|puff)\b/g,
];

/** Every dose, frequency or quantity phrase in a sentence, in canonical form. */
export function dosePhrases(sentence: string): string[] {
  const c = canonical(sentence);
  const found = new Set<string>();
  for (const re of PATTERNS) for (const m of c.matchAll(re)) found.add(m[0].trim());
  return [...found];
}

/** The phrases that aren't anywhere in the patient's own labels and strengths. */
export function unbackedDoses(sentence: string, records: string[]): string[] {
  const haystack = canonical(records.join(" . "));
  return dosePhrases(sentence).filter((p) => !haystack.includes(` ${p} `) && !haystack.includes(` ${p}`));
}
