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

const FILLER_TABLE: Record<string, readonly string[]> = {
  en: ["um", "uh", "erm", "er", "hmm"],
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
  zh: ["那个", "就是", "嗯"]
};

const removeFillers = (text: string, language = "en"): string => {
  const normalizedLocale = language.split("-")[0]?.toLowerCase() ?? "en";
  const fillersList = FILLER_TABLE[normalizedLocale] ?? FILLER_TABLE["en"] ?? [];
  const fillers = new Set(fillersList);
  return text
    .normalize("NFC")
    .split(/\s+/)
    .filter((word) => {
      const clean = word.replace(/[.,!?;:]+$/, "").toLocaleLowerCase(normalizedLocale);
      return !fillers.has(clean);
    })
    .join(" ");
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
