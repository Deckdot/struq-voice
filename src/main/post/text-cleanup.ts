/**
 * Text post-processing: pure functions applied to a transcript before it is
 * delivered or stored. Always on: trim and collapse whitespace. Optional:
 * custom dictionary replacements, filler removal, trailing punctuation.
 * No regex over user text without a test.
 */

import { applyDictionary } from "../../shared/dictionary";

export interface DictionaryEntry {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly enabled?: boolean;
}

export interface CleanupOptions {
  readonly dictionary: readonly DictionaryEntry[];
  readonly removeFillers: boolean;
  readonly addTrailingPunctuation: boolean;
  readonly speechLanguage?: string;
}

/**
 * Fillers per language. Every language the Speech language picker offers
 * needs an entry, because a language that is missing from this table
 * removes nothing at all (see `removeFillers`). An empty array is a
 * deliberate "this language's fillers are not established", which is the
 * safe answer: a kept filler is a blemish, a deleted real word is the
 * user's meaning changed.
 *
 * "er" is English-only on purpose. It is the present tense of "to be" in
 * Danish and Norwegian, so an English table applied to those languages
 * deletes the verb from every sentence.
 */
export const FILLER_TABLE: Record<string, readonly string[]> = {
  en: ["um", "umm", "uh", "uhh", "erm", "er", "hmm", "hm"],
  nl: ["eh", "ehm", "uhm", "uh"],
  de: ["äh", "ähm", "hm"],
  fr: ["euh", "ben", "hein", "bah"],
  es: ["eh", "este"],
  it: ["ehm"],
  pt: ["hum"],
  pl: ["yyy", "eee"],
  sv: ["öh", "ehm"],
  ru: ["э"],
  tr: ["ııı", "şey"],
  ja: ["えーと", "あの", "まあ"],
  zh: ["那个", "就是", "嗯"],
  da: ["øh", "øhm"],
  nb: ["eh", "øh"],
  fi: ["öö", "tota"],
  uk: ["е"],
  ko: ["음", "그"],
  ar: ["يعني"],
  hi: ["मतलब"],
  he: []
};

/**
 * The base subtag, but only when it is a language tag at all.
 *
 * `speechLanguage` carries the sentinel "auto" for detect-the-language, and an
 * engine that detects nothing reports null, so "auto" reaches here as a real
 * value. Intl rejects it: `"UM".toLocaleLowerCase("auto")` throws a RangeError,
 * which surfaced as "invalid language tag auto" on every capture with filler
 * removal switched on.
 *
 * Validated by asking Intl rather than by pattern matching, so anything Intl
 * cannot use falls back to English instead of throwing mid-delivery. Losing
 * a filler is a blemish; losing the transcript is the user's words gone.
 */
const resolveFillerLocale = (language: string): string | null => {
  const base = language.split("-")[0]?.toLowerCase() ?? "";
  if (base.length === 0) return null;
  try {
    Intl.getCanonicalLocales(base);
  } catch {
    return null;
  }
  return base;
};

/**
 * A language we have no filler table for removes nothing.
 *
 * The fallback used to be the English table, which is how "er" (Danish and
 * Norwegian for "is") was deleted from every sentence those users dictated.
 * Applying one language's fillers to another is not a near-miss, it is a
 * different language's vocabulary. Only an unusable tag ("auto", garbage)
 * still falls back to English, because that path means "no language was
 * established" rather than "this language has no table".
 */
const removeFillers = (text: string, language = "en"): string => {
  const resolved = resolveFillerLocale(language);
  const normalizedLocale = resolved ?? "en";
  const fillersList = resolved === null ? FILLER_TABLE["en"] : FILLER_TABLE[resolved];
  if (fillersList === undefined || fillersList.length === 0) {
    return text;
  }
  const fillers = new Set(fillersList);
  const words = text.normalize("NFC").split(/\s+/);
  const kept: string[] = [];
  // Whether the word now being decided starts a sentence. A filler dropped
  // from the front of one leaves the next word carrying a lower case letter
  // it was never meant to have ("Um so it works" became "so it works"), so
  // the replacement word is recapitalised to take its place.
  let atSentenceStart = true;
  let pendingCapitalisation = false;

  for (const word of words) {
    const clean = word
      .replace(/^[("'“‘]+/, "")
      .replace(/[.,!?;:)"'”’]+$/, "")
      .toLocaleLowerCase(normalizedLocale);
    const isFiller = fillers.has(clean) || fillers.has(collapseElongation(clean));
    if (isFiller) {
      // Only a filler that stood where a sentence began owes the next word a
      // capital. One removed mid-sentence changes no casing.
      if (atSentenceStart) pendingCapitalisation = true;
      continue;
    }
    kept.push(pendingCapitalisation ? capitalise(word, normalizedLocale) : word);
    pendingCapitalisation = false;
    atSentenceStart = /[.!?]["')”’]?$/.test(word);
  }
  return kept.join(" ");
};

/**
 * "ummm" and "uhhh" are the same filler as "um" and "uh". Speech recognition
 * spells a held vowel with however many letters it heard, so matching the
 * table literally missed most of them in real dictation.
 *
 * Only a run of three or more collapses. Collapsing doubled letters too
 * would fold "err" onto "er" and delete it from "err on the side of
 * caution", which is the same class of bug as the Danish "er" above: a real
 * word silently removed. Two letters stay two, so the shortest elongation
 * this catches is "ummm". "umm" and "uhh" are handled by the table itself.
 */
const collapseElongation = (word: string): string =>
  word.replace(/(.)\1{2,}/gu, "$1$1");

const capitalise = (word: string, locale: string): string => {
  // Code point rather than UTF-16 unit, so a word starting outside the BMP
  // is not split through the middle of a surrogate pair.
  const first = word.codePointAt(0);
  if (first === undefined) return word;
  const head = String.fromCodePoint(first);
  return head.toLocaleUpperCase(locale) + word.slice(head.length);
};

const addTrailingPunctuation = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  const last = trimmed[trimmed.length - 1] ?? "";
  if (/[.!?]/.test(last)) return trimmed;
  return `${trimmed}.`;
};

export const cleanupTranscript = (text: string, options: CleanupOptions): string => {
  let output = text.replace(/\s+/g, " ").trim();
  if (output.length === 0) return output;
  if (options.dictionary.length > 0) {
    output = applyDictionary(output, options.dictionary);
  }
  if (options.removeFillers) {
    output = removeFillers(output, options.speechLanguage ?? "en");
  }
  if (options.addTrailingPunctuation) {
    output = addTrailingPunctuation(output);
  }
  return output;
};
