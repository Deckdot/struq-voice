import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Escape is registered only for the duration of a capture, so pausing hotkeys
 * mid-capture and resuming has to put it back. These tests cover that seam;
 * the shortcut modules themselves are tested separately.
 */

const registered = new Set<string>();
const escapeHandlers: Array<() => void> = [];

vi.mock("electron", () => ({
  app: { quit: vi.fn() },
  globalShortcut: {
    register: vi.fn((accelerator: string, callback: () => void) => {
      registered.add(accelerator);
      if (accelerator === "Escape") escapeHandlers.push(callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      registered.delete(accelerator);
    })
  }
}));

vi.mock("./ptt-hook", () => ({
  createPttHook: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    setChord: vi.fn()
  })
}));

vi.mock("./toggle-shortcut", () => ({
  registerToggleShortcut: vi.fn(),
  unregisterToggleShortcut: vi.fn()
}));

vi.mock("./meeting-shortcut", () => ({
  registerMeetingShortcut: vi.fn(),
  unregisterMeetingShortcut: vi.fn()
}));

const { createHotkeys } = await import("./index");

const makeController = (): ReturnType<typeof createHotkeys> =>
  createHotkeys({
    e2e: false,
    onPttStart: () => {},
    onPttStop: () => {},
    onToggle: () => {},
    onMeetingToggle: () => {}
  });

beforeEach(() => {
  registered.clear();
  escapeHandlers.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("escape across a pause", () => {
  it("restores Escape when hotkeys resume mid-capture", () => {
    const hotkeys = makeController();
    const onEscape = vi.fn();

    hotkeys.registerEscape(onEscape);
    expect(registered.has("Escape")).toBe(true);

    // A game or a full-screen app pauses hotkeys while the capture is live.
    hotkeys.setPaused(true);
    expect(registered.has("Escape")).toBe(false);

    hotkeys.setPaused(false);
    expect(registered.has("Escape")).toBe(true);

    escapeHandlers.at(-1)?.();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("does not restore Escape when the capture ended before the resume", () => {
    const hotkeys = makeController();

    hotkeys.registerEscape(() => {});
    hotkeys.setPaused(true);
    // The capture finished while paused, so the session withdrew its request.
    hotkeys.unregisterEscape();
    hotkeys.setPaused(false);

    expect(registered.has("Escape")).toBe(false);
  });

  it("leaves Escape unregistered when nothing asked for it", () => {
    const hotkeys = makeController();

    hotkeys.setPaused(true);
    hotkeys.setPaused(false);

    expect(registered.has("Escape")).toBe(false);
  });
});
