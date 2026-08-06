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
  const bounded = rule.wholeWord ? `\\b${body}\\b` : body;
  return new RegExp(bounded, rule.matchCase ? "g" : "gi");
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
