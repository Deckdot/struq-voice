import { describe, expect, it } from "vitest";
import type { DictionaryRule } from "./dictionary";
import {
  MAX_RULE_FROM_LENGTH,
  applyDictionary,
  buildRulePattern,
  countRuleHits,
  escapeRegExp,
  findRuleByFrom,
  findRuleMatches,
  normalizeRuleFrom,
  upsertRule
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

describe("dictionary rule editing helpers", () => {
  const makeRule = (from: string, to = "replacement"): DictionaryRule => ({
    from,
    to,
    matchCase: false,
    wholeWord: true,
    enabled: true
  });

  describe("normalizeRuleFrom", () => {
    it("passes plain text through unchanged", () => {
      expect(normalizeRuleFrom("hello world")).toBe("hello world");
    });

    it("trims leading and trailing whitespace", () => {
      expect(normalizeRuleFrom("  hello world  ")).toBe("hello world");
    });

    it("collapses newlines to a single space", () => {
      expect(normalizeRuleFrom("hello\n\nworld")).toBe("hello world");
    });

    it("collapses tabs to a single space", () => {
      expect(normalizeRuleFrom("hello\t\tworld")).toBe("hello world");
    });

    it("collapses mixed whitespace runs to a single space", () => {
      expect(normalizeRuleFrom("hello \n\t world")).toBe("hello world");
    });

    it("returns null for empty input", () => {
      expect(normalizeRuleFrom("")).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      expect(normalizeRuleFrom("  \t\n  ")).toBeNull();
    });

    it("returns null when longer than MAX_RULE_FROM_LENGTH", () => {
      expect(normalizeRuleFrom("x".repeat(MAX_RULE_FROM_LENGTH + 1))).toBeNull();
    });

    it("accepts text exactly at MAX_RULE_FROM_LENGTH", () => {
      const text = "x".repeat(MAX_RULE_FROM_LENGTH);
      expect(normalizeRuleFrom(text)).toBe(text);
    });
  });

  describe("findRuleByFrom", () => {
    it("finds an existing rule by from", () => {
      const rules = [makeRule("alpha"), makeRule("beta")];
      expect(findRuleByFrom(rules, "beta")).toBe(rules[1]);
    });

    it("returns undefined when the from is absent", () => {
      const rules = [makeRule("alpha")];
      expect(findRuleByFrom(rules, "omega")).toBeUndefined();
    });

    it("matches case-insensitively", () => {
      const rules = [makeRule("Struq")];
      expect(findRuleByFrom(rules, "struq")).toBe(rules[0]);
    });

    it("returns undefined for an empty rules array", () => {
      expect(findRuleByFrom([], "anything")).toBeUndefined();
    });
  });

  describe("upsertRule", () => {
    it("appends when no rule matches and reports updated false", () => {
      const rules = [makeRule("alpha")];
      const added = makeRule("beta", "B");
      const { rules: next, updated } = upsertRule(rules, added);
      expect(updated).toBe(false);
      expect(next).toEqual([makeRule("alpha"), added]);
    });

    it("replaces the matching rule in place and reports updated true", () => {
      const rules = [makeRule("alpha"), makeRule("Struq"), makeRule("omega")];
      const replacement = makeRule("struq", "written");
      const { rules: next, updated } = upsertRule(rules, replacement);
      expect(updated).toBe(true);
      expect(next).toHaveLength(3);
      expect(next[1]).toBe(replacement);
      expect(next.map((rule) => rule.from)).toEqual(["alpha", "struq", "omega"]);
    });

    it("reports updated true only when a match exists", () => {
      expect(upsertRule([], makeRule("alpha")).updated).toBe(false);
      expect(upsertRule([makeRule("Alpha")], makeRule("alpha")).updated).toBe(true);
    });

    it("does not mutate the input array", () => {
      const rules = [makeRule("alpha"), makeRule("Struq")];
      const before = [...rules];
      upsertRule(rules, makeRule("struq", "written"));
      expect(rules).toEqual(before);
    });

    it("returns a new array rather than mutating in place", () => {
      const rules = [makeRule("alpha")];
      const { rules: next } = upsertRule(rules, makeRule("alpha", "A"));
      expect(next).not.toBe(rules);
    });

    it("preserves the position of the replaced rule", () => {
      const rules = [makeRule("alpha"), makeRule("Struq"), makeRule("omega")];
      const { rules: next } = upsertRule(rules, makeRule("struq", "written"));
      expect(next[1]?.to).toBe("written");
      expect(next[0]).toBe(rules[0]);
      expect(next[2]).toBe(rules[2]);
    });
  });
});

/**
 * Whole-word matching used \b, which is ASCII-only: every accented or
 * non-Latin character counts as a non-word character to it, so a rule whose
 * first or last character was one never fired, in the preview or in
 * delivery. "Müller" worked only because its boundaries happen to be ASCII.
 */
describe("whole-word rules on non-ASCII text", () => {
  const rule = (from: string, to: string): DictionaryRule => ({
    from,
    to,
    matchCase: false,
    wholeWord: true,
    enabled: true
  });

  it("fires for a rule ending in an accented character", () => {
    expect(applyDictionary("I want a café now", [rule("café", "coffee")])).toBe(
      "I want a coffee now"
    );
  });

  it("fires for a rule written entirely in a non-Latin script", () => {
    expect(applyDictionary("I flew to 東京 today", [rule("東京", "Tokyo")])).toBe(
      "I flew to Tokyo today"
    );
  });

  it("fires for a rule with an accent in the middle", () => {
    expect(applyDictionary("Mr Müller arrived", [rule("Müller", "Miller")])).toBe(
      "Mr Miller arrived"
    );
  });

  it("still refuses to match inside a larger word", () => {
    expect(applyDictionary("cafés everywhere", [rule("café", "coffee")])).toBe(
      "cafés everywhere"
    );
    expect(
      applyDictionary("underground struckley", [rule("struck", "Struq")])
    ).toBe("underground struckley");
  });

  it("matches a rule bounded by punctuation", () => {
    expect(applyDictionary("a café, please", [rule("café", "coffee")])).toBe(
      "a coffee, please"
    );
  });
});
