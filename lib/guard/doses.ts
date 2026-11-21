// S3: doses, frequencies and quantities. Each one the agent says must appear in the
// locked patient's label or prescription record.

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  eight: "8",
  ten: "10",
  twelve: "12",
  a: "1",
  an: "1",
};

const UNIT_WORDS: [RegExp, string][] = [
  [/\bmilligrams?\b/g, "mg"],
  [/\bmicrograms?\b/g, "mcg"],
  [/\bmillilit(?:re|er)s?\b/g, "ml"],
  [/\bgrams?\b/g, "g"],
  [/\b(tablet|capsule|pill|dose|puff|hour|day|week|night)s\b/g, "$1"],
  [/\b(?:daily|per day|each day|a day)\b/g, "a day"],
];

/** A canonical form so "two tablets", "2 tablets" and "2 tablet" compare equal. */
export function canonical(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
  for (const [re, to] of UNIT_WORDS) t = t.replace(re, to);
  t = t.replace(/\b(one|two|three|four|five|six|eight|ten|twelve)\b/g, (w) => NUMBER_WORDS[w]);
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
