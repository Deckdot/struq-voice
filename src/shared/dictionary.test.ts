import { describe, expect, it } from "vitest";
import type { DictionaryRule } from "./dictionary";
import {
  applyDictionary,
  buildRulePattern,
  countRuleHits,
  escapeRegExp,
  findRuleMatches
} from "./dictionary";

describe("dictionary matching primitives", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegExp("price (est.)")).toBe("price \\(est\\.\\)");
  });

  it("handles all four matchCase and wholeWord combinations", () => {
    const base: DictionaryRule = {
      from: "cat",
      to: "dog",
      matchCase: false,
      wholeWord: true,
      enabled: true
    };

    // 1. Case insensitive, whole word (default)
    expect(applyDictionary("The Cat in the catalog.", [base])).toBe("The dog in the catalog.");

    // 2. Case sensitive, whole word
    const caseSensitiveWhole: DictionaryRule = { ...base, matchCase: true };
    expect(applyDictionary("The Cat and cat in catalog.", [caseSensitiveWhole])).toBe(
      "The Cat and dog in catalog."
    );

    // 3. Case insensitive, substring (not whole word)
    const substringInsensitive: DictionaryRule = { ...base, wholeWord: false };
    expect(applyDictionary("The Cat in the catalog.", [substringInsensitive])).toBe(
      "The dog in the dogalog."
    );

    // 4. Case sensitive, substring
    const substringSensitive: DictionaryRule = { ...base, matchCase: true, wholeWord: false };
    expect(applyDictionary("The Cat in the catalog.", [substringSensitive])).toBe(
      "The Cat in the dogalog."
    );
  });

  it("handles regex special characters in from string", () => {
    const rule: DictionaryRule = {
      from: "price (est.)",
      to: "estimated price",
      matchCase: false,
      wholeWord: false,
      enabled: true
    };
    expect(applyDictionary("The price (est.) is high.", [rule])).toBe("The estimated price is high.");
  });

  it("skips disabled rules", () => {
    const rule: DictionaryRule = {
      from: "struck",
      to: "Struq",
      matchCase: false,
      wholeWord: true,
      enabled: false
    };
    expect(applyDictionary("I struck gold.", [rule])).toBe("I struck gold.");
  });

  it("finds all rule matches in text", () => {
    const rule: DictionaryRule = {
      from: "test",
      to: "check",
      matchCase: false,
      wholeWord: true,
      enabled: true
    };
    const matches = findRuleMatches("test one, test two, test three", rule);
    expect(matches).toEqual([
      { start: 0, end: 4 },
      { start: 10, end: 14 },
      { start: 20, end: 24 }
    ]);
  });

  it("handles empty from string safely", () => {
    const rule: DictionaryRule = {
      from: "",
      to: "something",
      matchCase: false,
      wholeWord: true,
      enabled: true
    };
    expect(findRuleMatches("some text", rule)).toEqual([]);
    expect(applyDictionary("some text", [rule])).toBe("some text");
  });

  it("allows deleting a word or phrase with empty to string", () => {
    const rule: DictionaryRule = {
      from: "you know",
      to: "",
      matchCase: false,
      wholeWord: true,
      enabled: true
    };
    expect(applyDictionary("It is, you know, very nice.", [rule])).toBe("It is, , very nice.");
  });

  it("counts rule hits correctly", () => {
    const rules: DictionaryRule[] = [
      { from: "alpha", to: "A", matchCase: false, wholeWord: true, enabled: true },
      { from: "beta", to: "B", matchCase: false, wholeWord: true, enabled: true },
      { from: "gamma", to: "G", matchCase: false, wholeWord: true, enabled: false }
    ];
    const hits = countRuleHits("alpha and alpha make beta", rules);
    expect(hits.get("alpha")).toBe(2);
    expect(hits.get("beta")).toBe(1);
    expect(hits.has("gamma")).toBe(false);
  });

  it("preserves replacement string dollar sign references per String.prototype.replace semantics", () => {
    const rule: DictionaryRule = {
      from: "cost",
      to: "$100",
      matchCase: false,
      wholeWord: true,
      enabled: true
    };
    // Note: $1 in replace string resolves to capture group if present or empty string if not bounded
    const pattern = buildRulePattern(rule);
    expect("cost".replace(pattern, rule.to)).toBe("$100");
  });
});
