import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerToggleShortcut,
  resetToggleShortcutState,
  shouldAttemptRegister,
  unregisterToggleShortcut,
  type ShortcutBinder
} from "./toggle-shortcut";

const TOGGLE = "CommandOrControl+Shift+Space";
const OTHER = "CommandOrControl+Alt+Space";

/** A binder that records calls and can be told to refuse registration. */
const createBinder = (succeeds = true): ShortcutBinder & {
  readonly registered: string[];
  readonly unregistered: string[];
} => {
  const registered: string[] = [];
  const unregistered: string[] = [];
  return {
    registered,
    unregistered,
    register: (accelerator) => {
      registered.push(accelerator);
      return succeeds;
    },
    unregister: (accelerator) => {
      unregistered.push(accelerator);
    }
  };
};

afterEach(() => {
  resetToggleShortcutState();
  vi.restoreAllMocks();
});

describe("register decision", () => {
  it("attempts an accelerator that has not been tried", () => {
    expect(shouldAttemptRegister(TOGGLE, { accelerator: TOGGLE, attempted: false })).toBe(true);
  });

  it("skips an accelerator already attempted", () => {
    expect(shouldAttemptRegister(TOGGLE, { accelerator: TOGGLE, attempted: true })).toBe(false);
  });

  it("attempts a different accelerator even after a previous attempt", () => {
    expect(shouldAttemptRegister(OTHER, { accelerator: TOGGLE, attempted: true })).toBe(true);
  });
});

describe("registerToggleShortcut", () => {
  it("binds the accelerator on the first call", () => {
    const binder = createBinder();
    expect(registerToggleShortcut(() => {}, TOGGLE, binder)).toBe(true);
    expect(binder.registered).toEqual([TOGGLE]);
  });

  it("does not re-bind the same accelerator twice", () => {
    const binder = createBinder();
    registerToggleShortcut(() => {}, TOGGLE, binder);
    registerToggleShortcut(() => {}, TOGGLE, binder);
    expect(binder.registered).toEqual([TOGGLE]);
  });

  // Boot registers once from init() and again from setHotkeys(). When the
  // accelerator belongs to another app, the user must not see the warning twice.
  it("warns once when the accelerator is owned by another application", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const binder = createBinder(false);

    expect(registerToggleShortcut(() => {}, TOGGLE, binder)).toBe(false);
    expect(registerToggleShortcut(() => {}, TOGGLE, binder)).toBe(false);

    expect(binder.registered).toEqual([TOGGLE]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("releases the old accelerator before binding a new one", () => {
    const binder = createBinder();
    registerToggleShortcut(() => {}, TOGGLE, binder);
    registerToggleShortcut(() => {}, OTHER, binder);

    expect(binder.unregistered).toEqual([TOGGLE]);
    expect(binder.registered).toEqual([TOGGLE, OTHER]);
  });

  it("retries an accelerator after it was explicitly unregistered", () => {
    const binder = createBinder();
    registerToggleShortcut(() => {}, TOGGLE, binder);
    unregisterToggleShortcut(binder);
    registerToggleShortcut(() => {}, TOGGLE, binder);

    expect(binder.registered).toEqual([TOGGLE, TOGGLE]);
  });

  it("invokes the callback the binder was given", () => {
    const callback = vi.fn();
    const captured: (() => void)[] = [];
    registerToggleShortcut(callback, TOGGLE, {
      register: (_accelerator, cb) => {
        captured.push(cb);
        return true;
      },
      unregister: () => {}
    });

    expect(captured).toHaveLength(1);
    captured[0]?.();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterToggleShortcut", () => {
  it("releases a bound accelerator", () => {
    const binder = createBinder();
    registerToggleShortcut(() => {}, TOGGLE, binder);
    unregisterToggleShortcut(binder);
    expect(binder.unregistered).toEqual([TOGGLE]);
  });

  it("does nothing when no accelerator is bound", () => {
    const binder = createBinder();
    unregisterToggleShortcut(binder);
    expect(binder.unregistered).toEqual([]);
  });
});
