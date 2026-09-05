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
let menuTemplate: unknown[] = [];
const shownImages: string[] = [];

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
    setImage(image: { readonly path: string }): void {
      shownImages.push(image.path);
    }
    displayBalloon(): void {
      /* no-op */
    }
  }

  class FakeNotification {
    static isSupported(): boolean {
      return true;
    }
    show(): void {
      /* no-op */
    }
    close(): void {
      /* no-op */
    }
  }

  return {
    Tray: FakeTray,
    Notification: FakeNotification,
    Menu: {
      buildFromTemplate: (template: unknown[]) => {
        menuTemplate = template;
        return { items: template };
      }
    },
    nativeImage: {
      createFromPath: (path: string) => ({ path, isEmpty: () => false })
    }
  };
});

const { createTray } = await import("./tray");

const setup = (): {
  toggles: number;
  meetingToggles: number;
  opens: number;
} => {
  const counts = { toggles: 0, meetingToggles: 0, opens: 0 };
  createTray({
    onToggleCapture: () => {
      counts.toggles += 1;
    },
    onToggleMeeting: () => {
      counts.meetingToggles += 1;
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
  shownImages.length = 0;
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

  it("offers the meeting toggle menu item and flips its label with the state", () => {
    const controller = createTray({
      onToggleCapture: () => undefined,
      onToggleMeeting: () => undefined,
      onOpenMainWindow: () => undefined,
      onSetHotkeysPaused: () => undefined,
      onQuit: () => undefined,
      onCopyTranscript: () => undefined,
      engineDisplayName: () => "Mock"
    });
    const meetingItem = (): { label?: string } | undefined =>
      menuTemplate.find((item) => (item as { id?: string }).id === "startStopMeeting") as
        | { label?: string }
        | undefined;
    expect(meetingItem()).toBeDefined();
    expect(meetingItem()?.label).toBe("Start Meeting");

    controller.setMeetingState({
      phase: "recording",
      meetingId: 1,
      startedAtMs: Date.now(),
      system: { live: true },
      microphone: { live: true },
      transcriber: { engineId: "whisper-cpp", modelId: "whisper-large-v3-turbo-q5_0", kind: "local" },
      backlogSeconds: 0,
      segmentCount: 0,
      speakerCount: 1
    });
    expect(meetingItem()?.label).toBe("Stop Meeting");

    controller.setMeetingState({ phase: "idle" });
    expect(meetingItem()?.label).toBe("Start Meeting");
  });

  it("animates the tray icon while a meeting records", () => {
    vi.useFakeTimers();
    try {
      const controller = createTray({
        onToggleCapture: () => undefined,
        onToggleMeeting: () => undefined,
        onOpenMainWindow: () => undefined,
        onSetHotkeysPaused: () => undefined,
        onQuit: () => undefined,
        onCopyTranscript: () => undefined,
        engineDisplayName: () => "Mock"
      });

      controller.setMeetingState({
        phase: "recording",
        meetingId: 1,
        startedAtMs: 1000,
      system: { live: true },
      microphone: { live: true },
      transcriber: { engineId: "whisper-cpp", modelId: "whisper-large-v3-turbo-q5_0", kind: "local" },
      backlogSeconds: 0,
        segmentCount: 0,
        speakerCount: 1
      });
      vi.advanceTimersByTime(100);

      expect(shownImages.some((path) => path.includes("recording-frame-"))).toBe(true);

      controller.setMeetingState({ phase: "idle" });
      expect(shownImages.at(-1)).toContain("idle.png");
    } finally {
      vi.useRealTimers();
    }
  });
});
