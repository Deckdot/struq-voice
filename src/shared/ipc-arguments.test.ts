/**
 * Regression guard for the window controls.
 *
 * The titlebar buttons were dead because they were wired as
 * `onClick={api.window.minimize}`. React invokes a click handler with its
 * SyntheticEvent, contextBridge forwards every argument it is given, and
 * ipcRenderer.send structured-clones them. A SyntheticEvent (like any object
 * carrying functions or DOM nodes) cannot be cloned, so the call threw "An
 * object could not be cloned" before the send ever reached main, and all
 * three controls silently did nothing.
 *
 * These tests pin the rule that broke: an IPC argument must survive
 * structured clone. structuredClone is the same algorithm Electron uses on
 * the bridge, so a value that fails here fails across IPC.
 */

import { describe, expect, it } from "vitest";

/** Stand-in for a React SyntheticEvent: nested functions and a DOM-ish node. */
const makeSyntheticEventLike = (): Record<string, unknown> => ({
  type: "click",
  bubbles: true,
  nativeEvent: { isTrusted: true },
  target: { tagName: "BUTTON", addEventListener: () => undefined },
  preventDefault: () => undefined,
  stopPropagation: () => undefined
});

const isIpcCloneable = (value: unknown): boolean => {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
};

describe("IPC argument cloneability", () => {
  it("rejects a React-style event, the value that broke the window controls", () => {
    expect(isIpcCloneable(makeSyntheticEventLike())).toBe(false);
  });

  it("rejects a bare function", () => {
    expect(isIpcCloneable(() => undefined)).toBe(false);
  });

  it("accepts calling a window control with no argument at all", () => {
    // What the fixed titlebar does: `() => { api.window.minimize(); }`.
    const sent: unknown[] = [];
    const send = (...args: readonly unknown[]): void => {
      for (const arg of args) {
        if (!isIpcCloneable(arg)) {
          throw new Error("An object could not be cloned.");
        }
        sent.push(arg);
      }
    };

    const minimize = (): void => {
      send();
    };
    const onClick = (_event: unknown): void => {
      minimize();
    };

    expect(() => {
      onClick(makeSyntheticEventLike());
    }).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("throws when a control is wired as a bare reference, the original bug", () => {
    const send = (...args: readonly unknown[]): void => {
      for (const arg of args) {
        if (!isIpcCloneable(arg)) {
          throw new Error("An object could not be cloned.");
        }
      }
    };

    // The old shape: contextBridge forwards whatever React passed through.
    const minimize = (...args: readonly unknown[]): void => {
      send(...args);
    };
    const onClick: (event: unknown) => void = minimize;

    expect(() => {
      onClick(makeSyntheticEventLike());
    }).toThrow("An object could not be cloned.");
  });

  it("accepts the payloads real channels send", () => {
    expect(isIpcCloneable({ text: "hello" })).toBe(true);
    expect(isIpcCloneable({ deviceId: "default" })).toBe(true);
    expect(isIpcCloneable({ patch: { autostart: true } })).toBe(true);
    expect(isIpcCloneable({ bands: [0.1, 0.5], level: 0.3 })).toBe(true);
  });
});
