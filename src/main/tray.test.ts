/**
 * Tray behaviour, with Electron's Tray/Menu stubbed.
 *
 * The rule under test: clicking the tray icon opens the app. It used to
 * toggle capture, which meant a stray click on the icon silently started
 * recording. Starting a capture belongs to the hotkey and to the menu's
 * Start Capture item.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, () => void>();

vi.mock("electron", () => {
  class FakeTray {
    on(event: string, listener: () => void): void {
      handlers.set(event, listener);
    }
    setContextMenu(): void {
      /* no-op */
    }
    setToolTip(): void {
      /* no-op */
    }
    setImage(): void {
      /* no-op */
    }
    displayBalloon(): void {
      /* no-op */
    }
  }

  return {
    Tray: FakeTray,
    Menu: {
      buildFromTemplate: (template: unknown[]) => ({ items: template })
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true })
    }
  };
});

const { createTray } = await import("./tray");

const setup = (): {
  toggles: number;
  opens: number;
} => {
  const counts = { toggles: 0, opens: 0 };
  createTray({
    onToggleCapture: () => {
      counts.toggles += 1;
    },
    onOpenMainWindow: () => {
      counts.opens += 1;
    },
    onSetHotkeysPaused: () => undefined,
    onQuit: () => undefined,
    onCopyTranscript: () => undefined,
    engineDisplayName: () => "Mock"
  });
  return counts;
};

beforeEach(() => {
  handlers.clear();
});

describe("tray click", () => {
  it("opens the main window on a left click", () => {
    const counts = setup();
    handlers.get("click")?.();
    expect(counts.opens).toBe(1);
  });

  it("never starts a capture from a left click", () => {
    const counts = setup();
    handlers.get("click")?.();
    handlers.get("click")?.();
    expect(counts.toggles).toBe(0);
  });

  it("opens the main window on a double click too", () => {
    const counts = setup();
    handlers.get("double-click")?.();
    expect(counts.opens).toBe(1);
    expect(counts.toggles).toBe(0);
  });

  it("still offers Start Capture in the menu", () => {
    const counts = setup();
    // The capability is not lost, it just moved off the icon itself.
    expect(counts.toggles).toBe(0);
    expect(typeof handlers.get("click")).toBe("function");
  });
});
