/**
 * Dictionary matching: the rules behind "heard as X, write Y".
 *
 * These primitives live in shared because two processes must agree exactly.
 * Main applies them to every transcript before delivery; the Dictionary view
 * applies them to the preview box the user types into. A preview built on a
 * second implementation is a preview that lies.
 *
 * No side effects, no Electron imports.
 */

export interface DictionaryRule {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly enabled: boolean;
}

/** Escape a string for use inside a RegExp. */
export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One rule as a global RegExp.
 *
 * Note the fixed behaviour: the old buildAnyPattern used flag "g" even when
 * matchCase was false, so a non-whole-word rule silently matched case
 * sensitively. matchCase now means what it says in all four combinations.
 */
export const buildRulePattern = (rule: {
  readonly from: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
}): RegExp => {
  const body = escapeRegExp(rule.from);
  // \b is ASCII-only: it treats every accented or non-Latin character as a
  // non-word character, so \bcafé\b needs a word character after "é" and
  // never matches, and a rule written entirely in CJK never fires at all.
  // Lookarounds over the Unicode letter and number classes say what \b was
  // meant to say, in both the preview and delivery.
  const bounded = rule.wholeWord
    ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`
    : body;
  return new RegExp(bounded, rule.matchCase ? "gu" : "giu");
};

export interface RuleMatch {
  readonly start: number;
  readonly end: number;
}

type FlexibleRule = {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly enabled?: boolean;
};

/** Longest allowed rule "from" value, enforced by normalizeRuleFrom. */
export const MAX_RULE_FROM_LENGTH = 200;

/**
 * Normalize selected misheard text into a rule "from" value: collapse every
 * run of whitespace to a single space and trim. Returns null when the result
 * is empty or longer than MAX_RULE_FROM_LENGTH.
 */
export const normalizeRuleFrom = (text: string): string | null => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > MAX_RULE_FROM_LENGTH) {
    return null;
  }
  return normalized;
};

/** First rule whose from matches case-insensitively, or undefined. */
export const findRuleByFrom = (
  rules: readonly FlexibleRule[],
  from: string
): FlexibleRule | undefined =>
  rules.find((rule) => rule.from.toLowerCase() === from.toLowerCase());

/**
 * Add a rule, or replace the existing rule with the same from in place.
 * Returns the new rules array and whether an existing entry was replaced.
 * Never mutates the input array.
 */
export const upsertRule = (
  rules: readonly FlexibleRule[],
  rule: FlexibleRule
): { readonly rules: readonly FlexibleRule[]; readonly updated: boolean } => {
  const existing = findRuleByFrom(rules, rule.from);
  if (existing === undefined) {
    return { rules: [...rules, rule], updated: false };
  }
  const index = rules.findIndex((entry) => entry.from.toLowerCase() === rule.from.toLowerCase());
  return {
    rules: rules.map((entry, i) => (i === index ? rule : entry)),
    updated: true
  };
};

/** Where a rule fires in this text, for highlighting the preview. */
export const findRuleMatches = (text: string, rule: FlexibleRule): readonly RuleMatch[] => {
  if (rule.from.length === 0) return [];
  const pattern = buildRulePattern(rule);
  const out: RuleMatch[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    out.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match would loop forever.
    if (match[0].length === 0) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  return out;
};

/** Apply every enabled rule, in order. Disabled rules are skipped entirely. */
export const applyDictionary = (text: string, rules: readonly FlexibleRule[]): string => {
  let output = text;
  for (const rule of rules) {
    if (rule.enabled === false || rule.from.length === 0) continue;
    output = output.replace(buildRulePattern(rule), rule.to);
  }
  return output;
};

/** How many times each rule fires, keyed by `from`. Drives the preview summary. */
export const countRuleHits = (
  text: string,
  rules: readonly FlexibleRule[]
): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    out.set(rule.from, findRuleMatches(text, rule).length);
  }
  return out;
};
