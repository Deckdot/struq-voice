import { describe, expect, it } from "vitest";
import {
  PTT_KEYCODE,
  decidePttAction,
  isPttChord,
  type PttEventKind,
  type PttKeyboardEvent
} from "./ptt-hook";

const keydown = (overrides: Partial<PttKeyboardEvent> = {}): PttKeyboardEvent => ({
  keycode: PTT_KEYCODE,
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

  it("recognises the chord", () => {
    expect(isPttChord(keydown())).toBe(true);
    expect(isPttChord(keydown({ shiftKey: true }))).toBe(false);
  });
});
