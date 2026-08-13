import { describe, expect, it } from "vitest";
import {
  cleanupTranscript,
  FILLER_TABLE,
  type CleanupOptions
} from "./text-cleanup";

const DEFAULT_OPTIONS: CleanupOptions = {
  dictionary: [],
  removeFillers: false,
  addTrailingPunctuation: false
};

describe("cleanupTranscript", () => {
  it("trims and collapses whitespace always", () => {
    expect(cleanupTranscript("  hello   world  ", DEFAULT_OPTIONS)).toBe("hello world");
  });

  it("returns empty for whitespace-only input", () => {
    expect(cleanupTranscript("   ", DEFAULT_OPTIONS)).toBe("");
  });

  /**
   * Regression: "auto" is the detect-the-language sentinel, not a BCP47 tag,
   * and Intl throws a RangeError on it. This reached users as "invalid
   * language tag auto" on every capture with filler removal switched on.
   */
  it("does not throw when the speech language is the auto sentinel", () => {
    expect(() =>
      cleanupTranscript("um hello there", {
        ...DEFAULT_OPTIONS,
        removeFillers: true,
        speechLanguage: "auto"
      })
    ).not.toThrow();
  });

  // The leading filler took the sentence's capital with it, so the word that
  // inherits the position is recapitalised.
  it("strips English fillers when the language is the auto sentinel", () => {
    expect(
      cleanupTranscript("um hello there", {
        ...DEFAULT_OPTIONS,
        removeFillers: true,
        speechLanguage: "auto"
      })
    ).toBe("Hello there");
  });

  it("falls back to English for any unusable language value", () => {
    for (const language of ["", "   ", "not a locale", "xx-YY-ZZ-bogus", "123"]) {
      expect(() =>
        cleanupTranscript("um hello", {
          ...DEFAULT_OPTIONS,
          removeFillers: true,
          speechLanguage: language
        })
      ).not.toThrow();
    }
  });

  it("still uses the per-language filler table for a real tag", () => {
    expect(
      cleanupTranscript("ehm hallo daar", {
        ...DEFAULT_OPTIONS,
        removeFillers: true,
        speechLanguage: "nl-NL"
      })
    ).toBe("Hallo daar");
  });

  it("applies case-insensitive whole-word replacements", () => {
    expect(
      cleanupTranscript("struck is a product", {
        ...DEFAULT_OPTIONS,
        dictionary: [{ from: "struck", to: "Struq", matchCase: false, wholeWord: true }]
      })
    ).toBe("Struq is a product");
  });

  it("applies case-sensitive replacements", () => {
    expect(
      cleanupTranscript("Go there. go now.", {
        ...DEFAULT_OPTIONS,
        dictionary: [{ from: "Go", to: "GO", matchCase: true, wholeWord: true }]
      })
    ).toBe("GO there. go now.");
  });

  it("applies any-position replacements", () => {
    expect(
      cleanupTranscript("tow ree is hard to say", {
        ...DEFAULT_OPTIONS,
        dictionary: [{ from: "tow ree", to: "Tauri", matchCase: false, wholeWord: false }]
      })
    ).toBe("Tauri is hard to say");
  });

  it("does not replace inside larger words with wholeWord", () => {
    expect(
      cleanupTranscript("underground struckley", {
        ...DEFAULT_OPTIONS,
        dictionary: [{ from: "struck", to: "Struq", matchCase: false, wholeWord: true }]
      })
    ).toBe("underground struckley");
  });

  it("removes standalone fillers", () => {
    expect(
      cleanupTranscript("um I think uh it works erm", {
        ...DEFAULT_OPTIONS,
        removeFillers: true
      })
    ).toBe("I think it works");
  });

  it("removes fillers with trailing punctuation", () => {
    expect(
      cleanupTranscript("um, I think uh, it works.", {
        ...DEFAULT_OPTIONS,
        removeFillers: true
      })
    ).toBe("I think it works.");
  });

  it("adds trailing punctuation when missing", () => {
    expect(
      cleanupTranscript("it works", {
        ...DEFAULT_OPTIONS,
        addTrailingPunctuation: true
      })
    ).toBe("it works.");
  });

  it("does not duplicate existing trailing punctuation", () => {
    expect(
      cleanupTranscript("it works!", {
        ...DEFAULT_OPTIONS,
        addTrailingPunctuation: true
      })
    ).toBe("it works!");
  });

  it("does not punctuate empty text", () => {
    expect(
      cleanupTranscript("  ", {
        ...DEFAULT_OPTIONS,
        addTrailingPunctuation: true
      })
    ).toBe("");
  });

  it("handles a dictionary entry with regex special characters", () => {
    expect(
      cleanupTranscript("price (est.)", {
        ...DEFAULT_OPTIONS,
        dictionary: [
          { from: "price (est.)", to: "estimate", matchCase: false, wholeWord: false }
        ]
      })
    ).toBe("estimate");
  });
});

/**
 * Filler removal must never apply one language's fillers to another. The
 * table used to fall back to English for any language it did not know, and
 * English lists "er", which is the present tense of "to be" in Danish and
 * Norwegian. Every affected user silently lost the verb from every sentence.
 */
describe("filler removal across languages", () => {
  const withFillers = (speechLanguage: string): CleanupOptions => ({
    ...DEFAULT_OPTIONS,
    removeFillers: true,
    speechLanguage
  });

  it("keeps the Danish verb 'er'", () => {
    expect(cleanupTranscript("Det er godt at være her", withFillers("da"))).toBe(
      "Det er godt at være her"
    );
  });

  it("keeps the Norwegian verb 'er'", () => {
    expect(cleanupTranscript("Jeg er glad i dag", withFillers("nb"))).toBe(
      "Jeg er glad i dag"
    );
  });

  it("still removes 'er' as a filler in English", () => {
    expect(cleanupTranscript("Um I think er it works", withFillers("en"))).toBe(
      "I think it works"
    );
  });

  it("removes nothing for a language with no filler table", () => {
    expect(cleanupTranscript("er is not a filler here", withFillers("cs"))).toBe(
      "er is not a filler here"
    );
  });

  /**
   * "auto" is the detect-the-language sentinel, not a language. It reaches
   * here whenever the engine reports no language, so it must stay on the
   * English table rather than becoming a no-op.
   */
  it("falls back to English for an unusable language tag", () => {
    expect(cleanupTranscript("Um I think it works", withFillers("auto"))).toBe(
      "I think it works"
    );
  });

  it("covers every language the speech picker offers", () => {
    // Mirrors the option list in views/settings/TranscriptionTab.tsx. A
    // language offered there but missing here removes no fillers at all,
    // which is safe but silently useless, so the two must not drift.
    const offered = [
      "en", "de", "fr", "es", "it", "nl", "pt", "pl", "ru", "zh",
      "ja", "ko", "ar", "hi", "tr", "sv", "da", "nb", "fi", "uk"
    ];
    const missing = offered.filter((tag) => FILLER_TABLE[tag] === undefined);
    expect(missing).toEqual([]);
  });
});

/**
 * Real dictation does not spell fillers the way a table does. Speech
 * recognition writes a held vowel with however many letters it heard, and a
 * filler at the front of a sentence takes the capital with it when removed.
 */
describe("filler removal on real dictation", () => {
  const en: CleanupOptions = {
    ...DEFAULT_OPTIONS,
    removeFillers: true,
    speechLanguage: "en"
  };

  it("removes elongated fillers", () => {
    expect(cleanupTranscript("Umm so ummm yeah", en)).toBe("So yeah");
    expect(cleanupTranscript("I think uhh it works", en)).toBe("I think it works");
  });

  it("recapitalises the word left at the start of a sentence", () => {
    expect(cleanupTranscript("Um so it works", en)).toBe("So it works");
    expect(cleanupTranscript("at most do. Um so we ship", en)).toBe(
      "at most do. So we ship"
    );
  });

  it("does not recapitalise a word from mid-sentence", () => {
    expect(cleanupTranscript("I think um it works", en)).toBe("I think it works");
  });

  /**
   * The elongation collapse must never fold a real word onto a filler.
   * Collapsing doubled letters turned "err" into "er" and deleted it from
   * "err on the side of caution", which is the English twin of the Danish
   * bug this whole change exists to fix.
   */
  it("keeps real words that resemble a filler", () => {
    expect(cleanupTranscript("err on the side of caution", en)).toBe(
      "err on the side of caution"
    );
    expect(cleanupTranscript("The summer hummed and I stammered", en)).toBe(
      "The summer hummed and I stammered"
    );
    expect(cleanupTranscript("Mississippi assessment committee", en)).toBe(
      "Mississippi assessment committee"
    );
  });

  it("strips fillers wrapped in punctuation", () => {
    expect(cleanupTranscript("Hmm. Um, I think it works.", en)).toBe(
      "I think it works."
    );
  });
});
