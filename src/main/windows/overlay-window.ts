/**
 * The floating capture overlay window lifecycle. Ported from
 * StruqADE/apps/desktop/src/main/voice-overlay.ts. Read its comments in the
 * source before changing anything: several requirements are non-obvious.
 *
 * The properties that make the product work:
 *
 * - `focusable: false`. The overlay can never take focus, so the Windows
 *   foreground window never changes while it is visible. A synthesised Ctrl+V
 *   therefore lands in the app the user was actually in. This is also why the
 *   panel cannot be dragged by the OS or by -webkit-app-region: dragging is
 *   done by hand, in the renderer, through the move channel below.
 * - `showInactive()`, never `show()`. `show()` steals focus and silently
 *   breaks paste delivery.
 * - `alwaysOnTop: true` in the constructor AND `setAlwaysOnTop(true,
 *   'floating')`. The constructor option alone is insufficient on Windows.
 * - Lazy creation in a try/catch. Some locked-down Windows configurations
 *   block always-on-top windows; the fallback is a Notification.
 *
 * Visibility is decided by capture state alone. An earlier version also hid
 * the panel whenever one of our own windows had focus, on the theory that the
 * main window was the indicator there. That made the panel disappear exactly
 * when a user dictating into Struq Voice itself was watching it, so the rule
 * is gone: if a capture is active, the panel is on screen.
 */

import { BrowserWindow, Notification, screen } from "electron";
import { join } from "node:path";
import type { CaptureState } from "../../shared/capture";
import { isActiveCapture } from "../../shared/capture";
import type { CaptureStateChangedEvent } from "../../shared/ipc";
import { captureStateChangedChannel, PRELOAD_CHANNELS } from "../../shared/ipc";
import type { OverlayPosition, Rect } from "../../shared/overlay-position";
import {
  clampToWorkArea,
  findHostWorkArea,
  resolveOverlayPosition
} from "../../shared/overlay-position";

/**
 * Notification-sized, and sized to what it actually shows. With the live
 * transcript off there is nothing but the visualiser and a timer, so the panel
 * is a compact strip; turning the transcript on grows it enough to read a few
 * lines. Reserving transcript space that stays empty just puts a large blank
 * well over the user's work.
 */
export const OVERLAY_WIDTH = 260;
export const OVERLAY_HEIGHT_COMPACT = 44;
export const OVERLAY_HEIGHT_TRANSCRIPT = 132;

export const overlayHeight = (liveTranscription: boolean): number =>
  liveTranscription ? OVERLAY_HEIGHT_TRANSCRIPT : OVERLAY_HEIGHT_COMPACT;

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export interface OverlayWindowOptions {
  /** Deterministic tests skip timing-sensitive behaviour. */
  readonly e2e: boolean;
  /** Where the panel was last left, restored across restarts. */
  readonly initialPosition?: OverlayPosition | null;
  /** Called when the user finishes dragging, to persist the new position. */
  readonly onPositionChange?: (position: OverlayPosition) => void;
  /** Read at broadcast time: the setting can change between captures. */
  readonly isLiveTranscriptionEnabled?: () => boolean;
}

export interface OverlayWindowController {
  /** Reflect a capture state: show the panel for active states, hide for idle. */
  update: (state: CaptureState) => void;
  /** The live overlay window, or null before first use or after failure. */
  getWindow: () => BrowserWindow | null;
  /** Move the panel to a screen position, clamped to a visible display. */
  moveTo: (x: number, y: number) => void;
  /** Call on app before-quit. */
  dispose: () => void;
}

let overlayWindow: BrowserWindow | null = null;

/**
 * The last state broadcast, replayed to the panel once its renderer is ready.
 *
 * The window is created lazily, on the first capture, and a capture starts by
 * broadcasting `listening` and showing the panel in the same tick. On a cold
 * start the renderer has not loaded yet, so that first broadcast arrives
 * before anything is listening for it and is lost: the panel came up blank on
 * the first capture of a session and worked on every one after, because by
 * then the window already existed.
 */
let lastState: CaptureState = { phase: "idle" };
let lastLiveTranscription = false;

/**
 * Where the user last dragged the panel. Held in memory and pushed to the
 * caller's persistence hook, so it survives both the window being destroyed
 * between captures and a restart.
 */
let storedPosition: OverlayPosition | null = null;
let persistPosition: ((position: OverlayPosition) => void) | null = null;

const workAreas = (): Rect[] =>
  screen.getAllDisplays().map((display) => display.workArea);

const createOverlayWindow = (height: number): BrowserWindow => {
  // The display under the cursor is where the user is working, so it is the
  // fallback when there is no usable stored position.
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const { x, y } = resolveOverlayPosition(
    storedPosition,
    workAreas(),
    workArea,
    OVERLAY_WIDTH,
    height
  );

  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/overlay.cjs"),
      // The sandboxed preload reads channel names from argv; they are
      // declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [channelsArg]
    }
  });

  // The constructor option is a hint; this is the actual promotion on Windows.
  window.setAlwaysOnTop(true, "floating");

  // Replay the current state as soon as the renderer can receive it. The
  // broadcast that started this capture went out before this window existed,
  // so without this the first capture of a session shows an empty panel.
  window.webContents.once("did-finish-load", () => {
    if (window.isDestroyed()) return;
    const payload: CaptureStateChangedEvent = {
      state: lastState,
      liveTranscription: lastLiveTranscription
    };
    window.webContents.send(captureStateChangedChannel, payload);
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/overlay/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/overlay/index.html"));
  }

  return window;
};

const ensureOverlayWindow = (height: number): BrowserWindow | null => {
  if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
    // The setting can change between captures, so the window is resized to
    // match rather than rebuilt. Keep the top-left anchored: growing downward
    // from where the user parked the panel is less surprising than having it
    // creep upward.
    const bounds = overlayWindow.getBounds();
    if (bounds.height !== height) {
      overlayWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: OVERLAY_WIDTH,
        height
      });
    }
    return overlayWindow;
  }
  try {
    overlayWindow = createOverlayWindow(height);
    return overlayWindow;
  } catch {
    overlayWindow = null;
    return null;
  }
};

const setOverlayVisible = (window: BrowserWindow | null, visible: boolean): void => {
  if (window === null) return;
  if (visible) {
    if (!window.isVisible()) {
      window.showInactive();
    }
  } else if (window.isVisible()) {
    window.hide();
  }
};

const broadcastState = (state: CaptureState, liveTranscription: boolean): void => {
  lastState = state;
  lastLiveTranscription = liveTranscription;
  const payload: CaptureStateChangedEvent = { state, liveTranscription };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(captureStateChangedChannel, payload);
    }
  }
};

let fallbackNotification: Notification | null = null;

const setFallbackNotification = (active: boolean): void => {
  if (active) {
    if (fallbackNotification !== null) return;
    try {
      const notification = new Notification({
        title: "Struq Voice is listening",
        body: "Release Ctrl+Space when done."
      });
      notification.show();
      fallbackNotification = notification;
    } catch {
      fallbackNotification = null;
    }
  } else {
    fallbackNotification = null;
  }
};

export const createOverlayWindowController = (
  options: OverlayWindowOptions
): OverlayWindowController => {
  storedPosition = options.initialPosition ?? null;
  persistPosition = options.onPositionChange ?? null;

  return {
    update: (state: CaptureState): void => {
      const live = options.isLiveTranscriptionEnabled?.() ?? false;
      broadcastState(state, live);

      const active = isActiveCapture(state);
      const window = ensureOverlayWindow(overlayHeight(live));
      if (window === null) {
        // Overlay construction blocked (always-on-top policy). Fall back to a
        // Notification so the user still has a cross-app signal.
        setFallbackNotification(active);
        return;
      }
      if (fallbackNotification !== null) {
        fallbackNotification = null;
      }

      setOverlayVisible(window, active);
    },
    getWindow: () => overlayWindow,
    moveTo: (x: number, y: number): void => {
      const window = overlayWindow;
      if (window === null || window.isDestroyed()) return;

      // Clamp against whichever display the panel is mostly over, so a drag
      // can cross monitors but cannot strand the panel off-screen. The height
      // is read from the window: it depends on whether the transcript shows.
      const panel: Rect = {
        x,
        y,
        width: OVERLAY_WIDTH,
        height: window.getBounds().height
      };
      const areas = workAreas();
      const host =
        findHostWorkArea(panel, areas) ??
        screen.getDisplayNearestPoint({ x, y }).workArea;
      const next = clampToWorkArea(panel, host);

      window.setPosition(next.x, next.y);
      storedPosition = next;
      persistPosition?.(next);
    },
    dispose: () => {
      if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
      }
      overlayWindow = null;
    }
  };
};
