/**
 * Intl.PluralRules wrapper supporting all six CLDR categories (zero, one, two, few, many, other)
 * with per-locale caching for high-frequency render passes.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export type PluralFormMap = Partial<Record<PluralCategory, string>> & { readonly other: string };

const pluralRulesCache = new Map<string, Intl.PluralRules>();

export const getPluralRules = (locale: string): Intl.PluralRules => {
  let rules = pluralRulesCache.get(locale);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
};

export const selectPluralForm = (
  locale: string,
  forms: PluralFormMap,
  count: number
): string => {
  const category = getPluralRules(locale).select(count);
  const form = forms[category];
  if (form !== undefined) return form;
  return forms.other;
};
