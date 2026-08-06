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
}

const FILLERS = new Set(["um", "uh", "erm", "er", "hmm"]);

const removeFillers = (text: string): string =>
  text
    .split(/\s+/)
    .filter((word) => {
      const clean = word.replace(/[.,!?;:]+$/, "").toLowerCase();
      return !FILLERS.has(clean);
    })
    .join(" ");

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
    output = removeFillers(output);
  }
  if (options.addTrailingPunctuation) {
    output = addTrailingPunctuation(output);
  }
  return output;
};
