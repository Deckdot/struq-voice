import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHORD,
  decidePttAction,
  matchesChordModifiers,
  type PttEventKind,
  type PttKeyboardEvent
} from "./ptt-hook";

const TRIGGER = DEFAULT_CHORD.keycode;

const keydown = (overrides: Partial<PttKeyboardEvent> = {}): PttKeyboardEvent => ({
  keycode: TRIGGER,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides
});

const ctrlKeyup = (): PttKeyboardEvent => ({
  keycode: 29,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false
});

const decide = (
  event: PttKeyboardEvent,
  kind: PttEventKind,
  active: boolean
): string => decidePttAction(event, kind, active);

describe("ptt decision logic", () => {
  it("starts on the first chord keydown while inactive", () => {
    expect(decide(keydown(), "down", false)).toBe("start");
  });

  it("ignores key repeat while active", () => {
    expect(decide(keydown(), "down", true)).toBe("none");
  });

  it("stops on the trigger keyup while active", () => {
    expect(decide(keydown({ ctrlKey: false }), "up", true)).toBe("stop");
  });

  it("does nothing on keyup while inactive", () => {
    expect(decide(keydown({ ctrlKey: false }), "up", false)).toBe("none");
  });

  it("stops when Ctrl is released mid-hold", () => {
    expect(decide(ctrlKeyup(), "up", true)).toBe("stop");
  });

  it("rejects a plain Space press", () => {
    expect(decide(keydown({ ctrlKey: false }), "down", false)).toBe("none");
  });

  it("rejects the chord when Shift is held", () => {
    expect(decide(keydown({ shiftKey: true }), "down", false)).toBe("none");
  });

  it("rejects the chord when Alt is held", () => {
    expect(decide(keydown({ altKey: true }), "down", false)).toBe("none");
  });

  it("rejects the chord when Win is held", () => {
    expect(decide(keydown({ metaKey: true }), "down", false)).toBe("none");
  });

  it("matches modifiers exactly", () => {
    expect(matchesChordModifiers(keydown(), DEFAULT_CHORD)).toBe(true);
    expect(matchesChordModifiers(keydown({ shiftKey: true }), DEFAULT_CHORD)).toBe(false);
  });

  it("honours a custom chord", () => {
    const custom = { keycode: 47, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(
      decidePttAction(
        { keycode: 47, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false },
        "down",
        false,
        custom
      )
    ).toBe("start");
  });
});
