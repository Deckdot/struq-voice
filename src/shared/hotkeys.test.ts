import { describe, expect, it } from "vitest";
import {
  parseAccelerator,
  formatChord,
  domEventToAccelerator,
  DEFAULT_PTT_ACCELERATOR,
  DEFAULT_TOGGLE_ACCELERATOR
} from "./hotkeys";

describe("parseAccelerator", () => {
  it("parses the default PTT chord", () => {
    expect(parseAccelerator(DEFAULT_PTT_ACCELERATOR)).toEqual({
      keycode: 57,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false
    });
  });

  it("parses the default toggle chord", () => {
    expect(parseAccelerator(DEFAULT_TOGGLE_ACCELERATOR)).toEqual({
      keycode: 57,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false
    });
  });

  it("parses a custom letter chord", () => {
    expect(parseAccelerator("Ctrl+Alt+A")).toEqual({
      keycode: 30,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      metaKey: false
    });
  });

  it("returns null for an unknown key", () => {
    expect(parseAccelerator("Ctrl+Foo")).toBeNull();
  });

  it("returns null for a malformed modifier", () => {
    expect(parseAccelerator("Bogus+Space")).toBeNull();
  });

  it("returns null for a bare modifier", () => {
    expect(parseAccelerator("Ctrl")).toBeNull();
  });
});

describe("formatChord", () => {
  it("formats a chord for display", () => {
    expect(formatChord({ keycode: 57, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }))
      .toBe("Ctrl+Shift+Space");
  });
});

describe("domEventToAccelerator", () => {
  it("maps a simple key", () => {
    expect(
      domEventToAccelerator({
        key: "v",
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      })
    ).toBe("V");
  });

  it("maps space with modifiers", () => {
    expect(
      domEventToAccelerator({
        key: " ",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false
      })
    ).toBe("Ctrl+Shift+Space");
  });

  it("maps an arrow key", () => {
    expect(
      domEventToAccelerator({
        key: "ArrowUp",
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      })
    ).toBe("ArrowUp");
  });

  it("rejects Escape, the reserved cancel key", () => {
    expect(
      domEventToAccelerator({
        key: "Escape",
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      })
    ).toBeNull();
  });
});
