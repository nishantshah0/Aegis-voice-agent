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

/**
 * The sentence as heard, in each way an invisible character can be heard: dropped
 * ("appr​oved" is "approved") or as a break ("it's​approved" is "it's approved").
 * One form when there are no invisible characters. Compatibility forms (fullwidth letters)
 * become plain, accents are dropped and lookalike letters become Latin.
 */
export function hearableForms(text: string): string[] {
  const forms = [text.replace(INVISIBLE, ""), text.replace(INVISIBLE, " ")].map(plain);
  return [...new Set(forms)];
}

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
