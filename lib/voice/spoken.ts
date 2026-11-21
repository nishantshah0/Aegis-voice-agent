// Rewrite a guarded line for the voice (SPEC Part 5, "Voice pipeline", Numbers).
//
// Runs after guardSentence, on `speak` only: the guard checks the words as written
// and the transcript shows them as written. This only changes how they sound, so
// a code is never read as one big number.
//   "Your code is 112358."  → "Your code is 1 1 2, 3 5 8."
//   "$4.10"                 → "four dollars and ten cents"
//   "36 mg"                 → "thirty-six milligrams"

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Whole numbers from 0 to 999,999 as words: 36 → "thirty-six". Larger ones stay as digits. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred` + (n % 100 ? ` and ${numberWords(n % 100)}` : "");
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  return `${numberWords(thousands)} thousand` + (rest ? (rest < 100 ? " and " : " ") + numberWords(rest) : "");
}

/** "112358" → "1 1 2, 3 5 8": read in two groups of three, digit by digit. */
export function digitByDigit(digits: string): string {
  const spaced = (s: string) => s.split("").join(" ");
  return digits.length === 6 ? `${spaced(digits.slice(0, 3))}, ${spaced(digits.slice(3))}` : spaced(digits);
}

function money(dollars: string, cents?: string): string {
  const d = Number(dollars.replace(/,/g, ""));
  const c = cents ? Number(cents.padEnd(2, "0")) : 0;
  const dollarWords = `${numberWords(d)} ${d === 1 ? "dollar" : "dollars"}`;
  if (!c) return dollarWords;
  const centWords = `${numberWords(c)} ${c === 1 ? "cent" : "cents"}`;
  return d ? `${dollarWords} and ${centWords}` : centWords;
}

const UNITS: Record<string, [string, string]> = {
  mg: ["milligram", "milligrams"],
  mcg: ["microgram", "micrograms"],
  ml: ["millilitre", "millilitres"],
  g: ["gram", "grams"],
};

function dose(amount: string, unit: string): string {
  const [one, many] = UNITS[unit.toLowerCase()];
  const value = Number(amount);
  const words = Number.isInteger(value) ? numberWords(value) : amount.split(".").map((p) => numberWords(Number(p))).join(" point ");
  return `${words} ${value === 1 ? one : many}`;
}

export function forSpeech(text: string): string {
  return (
    text
      // Codes and other long digit runs first, so money and doses never see them.
      .replace(/\b\d{6}\b/g, (code) => digitByDigit(code))
      .replace(/\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g, (_m, d: string, c?: string) => money(d, c))
      .replace(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|ml|g)\b/gi, (_m, amount: string, unit: string) => dose(amount, unit))
  );
}
