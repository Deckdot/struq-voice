/**
 * The cold-start replay.
 *
 * A capture broadcasts `listening` and shows the panel in the same tick, but
 * the overlay window is created lazily on that first capture. Its renderer has
 * not loaded when the broadcast goes out, so the event lands on nothing: the
 * panel came up blank on the first capture of a session and worked on every
 * one afterwards, because by then the window already existed.
 *
 * The controller therefore keeps the last state and replays it on
 * did-finish-load. These tests pin that behaviour at the level it actually
 * matters: what a freshly loaded renderer receives.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OverlayWindowController,
  OverlayWindowOptions
} from "./overlay-window";

interface SentMessage {
  readonly channel: string;
  readonly payload: unknown;
}

const sent: SentMessage[] = [];
const loadHandlers: (() => void)[] = [];
let destroyed = false;

vi.mock("electron", () => {
  class FakeWindow {
    webContents = {
      send: (channel: string, payload: unknown): void => {
        sent.push({ channel, payload });
      },
      once: (event: string, handler: () => void): void => {
        if (event === "did-finish-load") loadHandlers.push(handler);
      },
      getURL: () => "file:///overlay/index.html"
    };
    setAlwaysOnTop(): void {
      /* no-op */
    }
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    isDestroyed(): boolean {
      return destroyed;
    }
    isVisible(): boolean {
      return false;
    }
    showInactive(): void {
      /* no-op */
    }
    hide(): void {
      /* no-op */
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 260, height: 44 };
    }
    setBounds(): void {
      /* no-op */
    }
    setPosition(): void {
      /* no-op */
    }
    destroy(): void {
      destroyed = true;
    }
    static getAllWindows(): FakeWindow[] {
      return [];
    }
  }

  return {
    BrowserWindow: FakeWindow,
    Notification: class {
      static isSupported = (): boolean => false;
      show(): void {
        /* no-op */
      }
    },
    nativeTheme: {
      shouldUseDarkColors: false,
      themeSource: "system",
      on: (): void => {
        /* no-op */
      },
      off: (): void => {
        /* no-op */
      }
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      }),
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]
    }
  };
});

/**
 * The module keeps the overlay window in a module-level binding, so each test
 * gets a fresh copy: otherwise the second test reuses the first test's window
 * and never registers a new did-finish-load handler.
 */
const freshController = async (
  options: OverlayWindowOptions
): Promise<OverlayWindowController> => {
  vi.resetModules();
  sent.length = 0;
  loadHandlers.length = 0;
  destroyed = false;
  const module = await import("./overlay-window");
  return module.createOverlayWindowController(options);
};

beforeEach(() => {
  sent.length = 0;
  loadHandlers.length = 0;
  destroyed = false;
});

const stateEvents = (): { state: { phase: string } }[] =>
  sent
    .filter((message) => message.channel === "capture:state-changed")
    .map((message) => message.payload as { state: { phase: string } });

const meetingStateEvents = (): { phase: string }[] =>
  sent
    .filter((message) => message.channel === "meeting:state-changed")
    .map((message) => message.payload as { phase: string });

describe("overlay cold start", () => {
  it("replays the current state once the renderer has loaded", async () => {
    const controller = await freshController({ e2e: true });

    // The first capture of a session: the window does not exist yet.
    controller.update({ phase: "listening", startedAtMs: 1000 });
    expect(loadHandlers).toHaveLength(1);

    sent.length = 0;
    loadHandlers[0]?.();

    const replayed = stateEvents();
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.state.phase).toBe("listening");
  });

  it("replays the newest state, not the one that created the window", async () => {
    const controller = await freshController({ e2e: true });
    controller.update({ phase: "arming", reason: "warming stream" });
    controller.update({ phase: "listening", startedAtMs: 2000 });

    sent.length = 0;
    loadHandlers[0]?.();

    expect(stateEvents()[0]?.state.phase).toBe("listening");
  });

  it("replays idle rather than pinning a stale capture on screen", async () => {
    const controller = await freshController({ e2e: true });
    controller.update({ phase: "listening", startedAtMs: 3000 });
    controller.update({ phase: "idle" });

    sent.length = 0;
    loadHandlers[0]?.();

    expect(stateEvents()[0]?.state.phase).toBe("idle");
  });

  it("carries the live transcription flag through the replay", async () => {
    const controller = await freshController({
      e2e: true,
      isLiveTranscriptionEnabled: () => true
    });
    controller.update({ phase: "listening", startedAtMs: 4000 });

    sent.length = 0;
    loadHandlers[0]?.();

    const payload = sent[0]?.payload as { liveTranscription: boolean };
    expect(payload.liveTranscription).toBe(true);
  });

  it("does not send to a window destroyed before it finished loading", async () => {
    const controller = await freshController({ e2e: true });
    controller.update({ phase: "listening", startedAtMs: 5000 });

    destroyed = true;
    sent.length = 0;
    loadHandlers[0]?.();

    expect(sent).toHaveLength(0);
  });

  it("replays an active meeting when the feedback panel loads", async () => {
    const controller = await freshController({ e2e: true });
    controller.updateMeeting({
      phase: "recording",
      meetingId: 7,
      startedAtMs: 1000,
      system: { live: true },
      microphone: { live: true },
      backlogSeconds: 0,
      segmentCount: 0,
      speakerCount: 1
    });

    sent.length = 0;
    loadHandlers[0]?.();

    expect(meetingStateEvents()).toEqual([
      expect.objectContaining({ phase: "recording" })
    ]);
  });
});
