// 4.x (Trail #88): what a listener hears, so every speech rule reads that and not the
// characters the model wrote. Lookalike letters ("аpproved" with a Cyrillic а), fullwidth
// letters, accents and invisible characters ("appr​oved") all sound like the plain word.

// Letters from other scripts that look and sound like a Latin letter.
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  А: "A", а: "a", В: "B", в: "b", Е: "E", е: "e", К: "K", к: "k", М: "M", м: "m", Н: "H", н: "h", О: "O", о: "o",
  Р: "P", р: "p", С: "C", с: "c", Т: "T", т: "t", Х: "X", х: "x", У: "Y", у: "y", Ѕ: "S", ѕ: "s", І: "I", і: "i",
  Ј: "J", ј: "j", Ԁ: "D", ԁ: "d", Һ: "H", һ: "h", Ӏ: "I", ӏ: "l", Ԛ: "Q", ԛ: "q", Ԝ: "W", ԝ: "w", Ѵ: "V", ѵ: "v",
  // Greek
  Α: "A", α: "a", Β: "B", β: "b", Ε: "E", ε: "e", Ζ: "Z", Η: "H", Ι: "I", ι: "i", Κ: "K", κ: "k", Μ: "M", Ν: "N",
  ν: "v", Ο: "O", ο: "o", Ρ: "P", ρ: "p", Τ: "T", τ: "t", Υ: "Y", υ: "u", Χ: "X", χ: "x",
  // Armenian and Latin oddities
  օ: "o", ս: "u", ı: "i", ȷ: "j",
};
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");

// Characters nobody hears: zero-width spaces and joiners, soft hyphens, direction marks,
// variation selectors, tag characters, Hangul fillers.
const INVISIBLE =
  /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁤⁦-⁯ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]+/gu;

// Markup a voice reads differently from its text: <phoneme ph="set">x</phoneme> says "set",
// <sub alias="ready">r</sub> says "ready", and every other tag (<break/>) says nothing.
const SPOKEN_AS = /<(phoneme|sub)\b[^>]*\b(?:ph|alias)\s*=\s*["']([^"']*)["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<\/?[a-z][^>]*>/gi;
// Markdown emphasis ("**ap**proved") is not heard.
const MARKDOWN = /[*_`~]+/g;
// A word broken by a hyphen ("ap-proved", "Riv-era") is heard as one word; a number said with
// a hyphen ("forty-one") stays two number words.
const HYPHENATED = /\p{L}+(?:-\p{L}+)+/gu;
const NUMBER_WORDS = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred"]);
const joinBroken = (w: string) => (w.split("-").every((p) => NUMBER_WORDS.has(p.toLowerCase())) ? w : w.replace(/-/g, ""));
// Letters or digits spelled one at a time ("A-P-P-R-O-V-E-D", "S A M", "N 6 A 0 A 1").
const SPELLED = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][-. ]){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;
// Leetspeak inside a word ("4ppr0v3d", "s3t"); never a dose, a time or an ordinal ("36mg", "3pm", "2nd").
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a" };
const NOT_LEET = /^(?:\d+(?:\.\d+)?(?:mg|mcg|ml|g|am|pm|st|nd|rd|th|s|x|k|h|hr|hrs|min)?|x\d+|rx\d+)$/i;
// A postal code is written in capitals ("N6A 0A1"); "s3t" is leetspeak.
const POSTAL = /^(?:[A-Z]\d[A-Z](?:\d[A-Z]\d)?|\d[A-Z]\d)$/;

function leet(text: string): string {
  return text.replace(/[\p{L}\p{N}@]+/gu, (w) => (/\p{L}/u.test(w) && /[\d@]/.test(w) && !NOT_LEET.test(w) && !POSTAL.test(w) ? w.replace(/[0134578@]/g, (d) => LEET[d]) : w));
}

/**
 * The sentence as heard, in each way it can be heard. Joined: invisible characters, tags,
 * markdown and in-word hyphens are dropped, spelled-out letters are one word and leetspeak is
 * letters ("appr​oved", "ap<break/>proved", "A-P-P-R-O-V-E-D" and "4ppr0v3d" are all
 * "approved"). Spaced: invisible characters and tags are breaks ("it's​approved" is
 * "it's approved"), as written otherwise. In both, compatibility forms (fullwidth letters)
 * are plain, accents are dropped and lookalike letters are Latin.
 */
export function hearableForms(text: string): string[] {
  const spoken = text.replace(SPOKEN_AS, "$2");
  const joined = leet(spoken.replace(INVISIBLE, "").replace(TAG, "").replace(MARKDOWN, "").replace(HYPHENATED, joinBroken).replace(SPELLED, (m) => m.replace(/[-. ]/g, "")));
  const spaced = spoken.replace(INVISIBLE, " ").replace(TAG, " ").replace(MARKDOWN, "");
  return [...new Set([plain(joined), plain(spaced)])];
}

/** Letters in a script the guard can't read (anything but Latin, after lookalikes are mapped). */
export const UNREADABLE = /(?![\p{Script=Latin}])\p{L}/u;

function plain(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").replace(LOOKALIKE, (c) => LOOKALIKES[c] ?? c).normalize("NFC");
}

// Digits said as words: "five five five, oh one oh one", "one double oh two oh one",
// "nineteen ninety", "the fourteenth of March".
const DIGIT: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
};
const TEEN: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  twentieth: 20, thirtieth: 30,
};
const REPEAT: Record<string, number> = { double: 2, triple: 3 };
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december)";

/**
 * `words()`-style text with every run of number words written as its digits, so record
 * tokens and digit runs can be matched in it: "is it 5550101", "march 14", "14 march".
 */
export function digitText(wordsText: string): string {
  const out: string[] = [];
  const tokens = wordsText.trim().split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t in REPEAT && next !== undefined && next in DIGIT) {
      out.push(String(DIGIT[next]).repeat(REPEAT[t]));
      i++;
    } else if (t in TENS && next !== undefined && next in DIGIT && DIGIT[next] > 0) {
      out.push(String(TENS[t] + DIGIT[next]));
      i++;
    } else if (t === "hundred" && out.length > 0 && /^\d$/.test(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]}00`;
    } else if (t in DIGIT && !(t === "o" && next !== undefined && !(next in DIGIT))) {
      out.push(String(DIGIT[t]));
    } else if (t in TEEN) out.push(String(TEEN[t]));
    else if (t in TENS) out.push(String(TENS[t]));
    else out.push(t);
  }
  // Join digit groups said one after another ("555 0101" is one number), and drop the "of"
  // in "14 of march" so it reads like the record's "14 march".
  const joined = ` ${out.join(" ")} `.replace(/(\d) (?=\d)/g, "$1");
  return joined.replace(new RegExp(`\\b(\\d{1,2}) of ${MONTH}\\b`, "g"), "$1 $2");
}

/** "Sam's" heard as the name "Sam". */
export function withoutPossessives(text: string): string {
  return text.replace(/(\p{L})['’]s\b/gu, "$1");
}
