import { describe, expect, it } from "vitest";
import {
  cleanupTranscript,
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
